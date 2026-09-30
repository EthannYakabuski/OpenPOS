import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:net';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { OpenPOSService } from '../src/main/service';
import { SyncClient } from '../src/main/sync';
import type { DeviceConfig, OrderDraft } from '../src/shared/types';

const folders: string[] = [],
  services: OpenPOSService[] = [],
  clients: SyncClient[] = [];
async function service() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'openpos-sync-'));
  folders.push(folder);
  const app = new OpenPOSService(folder);
  services.push(app);
  await app.init();
  return app;
}
async function port() {
  const server = createServer();
  return new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const selected = (server.address() as { port: number }).port;
      server.close(() => resolve(selected));
    });
  });
}
async function until(check: () => boolean, timeout = 6500) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(check()).toBe(true);
}
const draft = (id = 'network-cart'): OrderDraft => ({
  id,
  lines: [
    {
      id: 'network-line',
      menuItemId: 'snickers-bar',
      quantity: 2,
      name: '',
      unitPrice: 0,
      recipe: [],
      notes: ''
    }
  ],
  feeIds: [],
  fulfillment: 'takeout',
  customerName: 'Network customer',
  phone: '',
  address: '',
  notes: ''
});
async function pair() {
  const master = await service(),
    one = await service(),
    two = await service();
  const masterConfig = {
    ...master.getSnapshot().device,
    role: 'master' as const,
    port: await port(),
    registeredClients: [one, two].map((s, n) => ({
      id: s.getSnapshot().device.clientId,
      name: `Kitchen ${n + 1}`
    }))
  };
  await master.setPassword('master-password');
  await master.saveDevice(masterConfig);
  for (const client of [one, two])
    await client.saveDevice({
      ...client.getSnapshot().device,
      role: 'client',
      serverUrl: `http://127.0.0.1:${masterConfig.port}`,
      syncKey: masterConfig.syncKey
    });
  return { master, one, two, masterConfig };
}
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await Promise.all(services.splice(0).map((s) => s.close()));
  await Promise.all(folders.splice(0).map((f) => fs.rm(f, { recursive: true, force: true })));
});

describe('Registered LAN clients', () => {
  it('pairs without uploading client demo data and propagates client orders/completion exactly once', async () => {
    const { master, one, two } = await pair();
    const initial = master.getSnapshot().state.orders.length;
    expect(one.getSnapshot().state.orders.map((o) => o.id)).toEqual(
      master.getSnapshot().state.orders.map((o) => o.id)
    );
    expect(one.getSnapshot().session.isAdmin).toBe(false);
    await one.execute({ type: 'save-order', draft: draft() });
    await until(() => two.getSnapshot().state.orders.some((o) => o.id === 'network-cart'));
    const order = two.getSnapshot().state.orders.find((o) => o.id === 'network-cart')!;
    const stock = master.getSnapshot().state.inventory.find((i) => i.id === 'snickers')!.quantity;
    await two.execute({ type: 'complete-order', id: order.id, expectedRevision: order.revision });
    await until(
      () => one.getSnapshot().state.orders.find((o) => o.id === order.id)?.status === 'completed'
    );
    await one.execute({ type: 'save-order', draft: draft() });
    expect(master.getSnapshot().state.orders.length).toBe(initial + 1);
    expect(master.getSnapshot().state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(
      stock - 2
    );
    await expect(
      one.execute({ type: 'save-order', draft: { ...draft(), customerName: 'Changed after save' } })
    ).rejects.toThrow('already saved');
  });
  it('rejects stale concurrent edits and protects shared administration on the master', async () => {
    const { master, one, two } = await pair();
    await one.execute({ type: 'save-order', draft: draft() });
    await until(() => two.getSnapshot().state.orders.some((o) => o.id === 'network-cart'));
    const order = one.getSnapshot().state.orders.find((o) => o.id === 'network-cart')!;
    const results = await Promise.allSettled([
      one.execute({
        type: 'save-order',
        draft: { ...order, expectedRevision: order.revision, feeIds: [], notes: 'Kitchen one' }
      }),
      two.execute({
        type: 'save-order',
        draft: { ...order, expectedRevision: order.revision, feeIds: [], notes: 'Kitchen two' }
      })
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const state = one.getSnapshot().state;
    await expect(
      one.execute({ type: 'save-config', config: state.config, expectedRevision: state.revision })
    ).rejects.toThrow('Unlock');
    await expect(
      one.execute({ type: 'restock', inventoryId: 'snickers', quantity: 2, note: '' })
    ).rejects.toThrow('Unlock');
    await expect(one.unlock('incorrect')).rejects.toThrow('incorrect');
    await one.unlock('master-password');
    await one.execute({
      type: 'restock',
      inventoryId: 'snickers',
      quantity: 2,
      note: 'Master authorized restock'
    });
    expect(master.getSnapshot().state.movements.at(-1)?.note).toBe('Master authorized restock');
    await master.setPassword('replacement-password', 'master-password');
    await until(() => !one.getSnapshot().session.isAdmin);
    await expect(one.getAudit('2026-01-01', '2026-12-31')).rejects.toThrow('Unlock');
  });
  it('shows cached data offline, rejects disconnected writes and reconnects after master restart', async () => {
    const paired = await pair();
    const { one, masterConfig } = paired;
    const folder = paired.master.dataPath;
    await one.execute({ type: 'save-order', draft: draft() });
    await paired.master.close();
    await until(() => !one.getSnapshot().sync.connected);
    expect(one.getSnapshot().state.orders.some((o) => o.id === 'network-cart')).toBe(true);
    await expect(
      one.execute({ type: 'save-order', draft: draft('offline-order') })
    ).rejects.toThrow('offline');
    const restarted = new OpenPOSService(folder);
    services.push(restarted);
    await restarted.init();
    expect(restarted.getSnapshot().device.port).toBe(masterConfig.port);
    await until(() => one.getSnapshot().sync.connected);
    await one.execute({ type: 'save-order', draft: draft() });
    expect(
      restarted.getSnapshot().state.orders.filter((o) => o.id === 'network-cart')
    ).toHaveLength(1);
  });
  it('keeps a confirmed sale successful if the local cache fails, and retries caching later', async () => {
    const { master, one } = await pair();
    const cache = path.join(one.dataPath, 'client-cache.json');
    await fs.unlink(cache);
    await fs.mkdir(cache);
    const result = await one.execute({ type: 'save-order', draft: draft('cache-failure-cart') });
    expect(result.sync.connected).toBe(true);
    expect(result.warning).toContain('saved on the master');
    expect(
      master.getSnapshot().state.orders.filter((o) => o.id === 'cache-failure-cart')
    ).toHaveLength(1);
    await fs.rmdir(cache);
    await until(() => !one.getSnapshot().warning);
    expect(
      JSON.parse(await fs.readFile(cache, 'utf8')).state.orders.some(
        (o: any) => o.id === 'cache-failure-cart'
      )
    ).toBe(true);
  });
  it('keeps device controls available when a pairing key is wrong and accepts a corrected key', async () => {
    const master = await service(),
      client = await service();
    const config = {
      ...master.getSnapshot().device,
      role: 'master' as const,
      port: await port(),
      registeredClients: [{ id: client.getSnapshot().device.clientId, name: 'Kitchen' }]
    };
    await master.setPassword('master-password');
    await master.saveDevice(config);
    const bad = {
      ...client.getSnapshot().device,
      role: 'client' as const,
      serverUrl: `http://127.0.0.1:${config.port}`,
      syncKey: 'invalid-key-that-is-long-enough'
    };
    await client.saveDevice(bad);
    expect(client.getSnapshot().sync.connected).toBe(false);
    expect(client.getSnapshot().session.isAdmin).toBe(true);
    expect(client.getSnapshot().state.orders).toHaveLength(0);
    await client.saveDevice({ ...bad, syncKey: config.syncKey });
    expect(client.getSnapshot().sync.connected).toBe(true);
    expect(client.getSnapshot().session.isAdmin).toBe(false);
  });
  it('uses lightweight unchanged replies, rejects unregistered devices and limits requests', async () => {
    const { one, masterConfig } = await pair();
    const transport = new SyncClient(
      one.getSnapshot().device,
      async () => {},
      () => {}
    );
    clients.push(transport);
    const first = await transport.request('/v1/snapshot', {});
    const next = await transport.request('/v1/snapshot', {
      revision: first.state.revision,
      authorityId: first.authorityId,
      serverEpoch: first.serverEpoch
    });
    expect(next.unchanged).toBe(true);
    expect(next.state).toBeUndefined();
    expect(JSON.stringify(next).length).toBeLessThan(500);
    const unknown = new SyncClient(
      { ...one.getSnapshot().device, clientId: 'not-registered' },
      async () => {},
      () => {}
    );
    clients.push(unknown);
    await expect(unknown.request('/v1/snapshot', {})).rejects.toThrow('authentication');
    await expect(
      transport.request('/v1/execute', { text: 'a'.repeat(2 * 1024 * 1024) })
    ).rejects.toThrow('too large');
    expect(masterConfig.syncKey.length).toBeGreaterThanOrEqual(24);
    await expect(
      transport.request('/v1/execute', {
        command: { type: 'save-order', draft: draft('stale-epoch-cart') },
        serverEpoch: 'old-server-process'
      })
    ).rejects.toThrow('restarted');
  });
});

function signedRequest(
  device: DeviceConfig,
  nonce: string,
  stamp = String(Date.now()),
  origin?: string
): Promise<{ status: number; body: any }> {
  const raw = '{}',
    route = '/v1/snapshot';
  const hash = createHash('sha256').update(raw).digest('hex');
  const signature = createHmac('sha256', device.syncKey)
    .update(['POST', route, stamp, nonce, hash].join('\n'))
    .digest('hex');
  return new Promise((resolve, reject) => {
    const req = http.request(
      new URL(route, device.serverUrl),
      {
        method: 'POST',
        headers: {
          'X-OpenPOS-Client': device.clientId,
          'X-OpenPOS-Time': stamp,
          'X-OpenPOS-Nonce': nonce,
          'X-OpenPOS-Signature': signature,
          ...(origin ? { Origin: origin } : {})
        }
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(text) }));
      }
    );
    req.on('error', reject);
    req.end(raw);
  });
}
describe('Transport authentication', () => {
  it('rejects replayed requests, stale timestamps and browser-origin traffic', async () => {
    const { one } = await pair();
    const config = one.getSnapshot().device,
      nonce = randomUUID();
    expect((await signedRequest(config, nonce)).status).toBe(200);
    expect((await signedRequest(config, nonce)).status).toBe(409);
    expect((await signedRequest(config, randomUUID(), String(Date.now() - 120000))).status).toBe(
      401
    );
    expect(
      (await signedRequest(config, randomUUID(), String(Date.now()), 'https://example.com')).status
    ).toBe(403);
  });
});
