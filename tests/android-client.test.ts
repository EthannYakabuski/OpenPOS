import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { AndroidClient } from '../src/android/client';
import type { AndroidNativePort } from '../src/android/native';
import { OpenPOSService } from '../src/main/service';
import { SyncClient } from '../src/main/sync';
import type { DeviceConfig, MobileConnection, OrderDraft } from '../src/shared/types';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
async function freePort() {
  const server = createServer();
  return new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    })
  );
}
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openpos-android-'));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  let master = new OpenPOSService(directory);
  await master.init();
  cleanup.push(() => master.close());
  await master.setPassword('android-master-password');
  const config: DeviceConfig = {
    ...master.getSnapshot().device,
    role: 'master',
    port: await freePort(),
    registeredClients: [{ id: 'android-test-client', name: 'Android test device' }]
  };
  await master.saveDevice(config);
  let connection: MobileConnection = {
    clientId: 'android-test-client',
    deviceName: 'Phone',
    serverUrl: `http://127.0.0.1:${config.port}`,
    defaultTab: 'menu',
    configured: false
  };
  let device = { ...config, ...connection, role: 'client' as const, syncKey: config.syncKey };
  const transport = new SyncClient(
    device,
    async () => {},
    () => {}
  );
  cleanup.push(() => transport.close());
  let offline = false;
  const native: AndroidNativePort = {
    getConnection: vi.fn(async () => ({ ...connection })),
    saveConnection: vi.fn(async (input) => {
      connection = {
        deviceName: input.deviceName,
        clientId: input.clientId,
        serverUrl: input.serverUrl,
        defaultTab: input.defaultTab,
        configured: true
      };
      Object.assign(device, connection);
      if (input.syncKey) device.syncKey = input.syncKey;
      return { ...connection };
    }),
    request: vi.fn(async ({ route, body }) => {
      if (offline) throw new Error('Network unavailable');
      const result = await transport.request(route, JSON.parse(body));
      return { body: JSON.stringify(result) };
    }),
    printHtml: vi.fn(async () => {}),
    shareFile: vi.fn(async () => {}),
    openHelp: vi.fn(async () => {})
  };
  const client = new AndroidClient(native, 0);
  cleanup.push(() => client.dispose());
  const pair = () =>
    client.saveConnection({ ...connection, syncKey: config.syncKey, rePair: true });
  return {
    client,
    native,
    pair,
    config,
    transport,
    get master() {
      return master;
    },
    setOffline(value: boolean) {
      offline = value;
    },
    async restart() {
      await master.close();
      master = new OpenPOSService(directory);
      await master.init();
    }
  };
}
const draft = (id = 'android-sale'): OrderDraft => ({
  id,
  expectedRevision: undefined,
  lines: [
    {
      id: 'line',
      menuItemId: 'snickers-bar',
      name: 'Untrusted price',
      unitPrice: 1,
      quantity: 2,
      recipe: [],
      notes: ''
    }
  ],
  feeIds: [],
  fulfillment: 'takeout',
  customerName: '',
  phone: '',
  address: '',
  notes: ''
});

describe('Android shared-UI client and Windows master', () => {
  it('starts empty, pairs without uploading demo records, and never exposes a sync key', async () => {
    const f = await fixture();
    const first = await f.client.getSnapshot();
    expect(first.state.menu).toEqual([]);
    expect(first.state.orders).toEqual([]);
    expect(first.session.isAdmin).toBe(false);
    expect(f.native.request).not.toHaveBeenCalled();
    const count = f.master.getSnapshot().state.orders.length;
    const paired = await f.pair();
    expect(paired.sync.connected).toBe(true);
    expect(paired.state.orders).toHaveLength(count);
    expect(paired.state.menu.length).toBeGreaterThan(0);
    expect(JSON.stringify(paired)).not.toContain(f.config.syncKey);
    expect(JSON.stringify(await f.client.getConnection())).not.toContain(f.config.syncKey);
    expect(paired.device.role).toBe('client');
  });
  it('lets staff order while the master controls price and completion consumes inventory once', async () => {
    const f = await fixture();
    const paired = await f.pair();
    const stock = paired.state.inventory.find((item) => item.id === 'snickers')!.quantity;
    const saved = await f.client.execute({ type: 'save-order', draft: draft() });
    const order = saved.state.orders.find((item) => item.id === 'android-sale')!;
    expect(order.lines[0].unitPrice).toBe(
      paired.state.menu.find((item) => item.id === 'snickers-bar')!.price
    );
    expect(order.lines[0].recipe.length).toBeGreaterThan(0);
    await f.client.execute({
      type: 'complete-order',
      id: order.id,
      expectedRevision: order.revision
    });
    await f.client.execute({ type: 'save-order', draft: draft() });
    expect(
      f.master.getSnapshot().state.inventory.find((item) => item.id === 'snickers')!.quantity
    ).toBe(stock - 2);
    expect(f.master.getSnapshot().state.orders.filter((item) => item.id === order.id)).toHaveLength(
      1
    );
  });
  it('protects owner configuration at both adapter and master and detects concurrent edits', async () => {
    const f = await fixture();
    const before = await f.pair();
    const change = {
      type: 'save-config' as const,
      config: { ...before.state.config, taxRate: 7.5 },
      expectedRevision: before.state.revision
    };
    await expect(f.client.execute(change)).rejects.toThrow('Unlock');
    await expect(
      f.transport.request('/v1/execute', { command: change, serverEpoch: 'ignored' })
    ).rejects.toThrow();
    await f.client.unlock('android-master-password');
    const saved = await f.client.execute(change);
    expect(f.master.getSnapshot().state.config.taxRate).toBe(7.5);
    await expect(f.client.execute(change)).rejects.toThrow('changed');
    await f.client.lock();
    await expect(f.client.getAudit('2020-01-01', '2040-01-01')).rejects.toThrow('Unlock');
    expect(saved.state.revision).toBeGreaterThan(before.state.revision);
  });
  it('does not retry an interrupted write and recovers the committed result by polling', async () => {
    const f = await fixture();
    await f.pair();
    const nativeRequest = f.native.request;
    f.native.request = vi.fn(async (request) => {
      const result = await nativeRequest(request);
      if (request.route === '/v1/execute') throw new Error('Reply was interrupted');
      return result;
    });
    await expect(f.client.execute({ type: 'save-order', draft: draft() })).rejects.toThrow(
      'interrupted'
    );
    expect(
      vi.mocked(f.native.request).mock.calls.filter(([request]) => request.route === '/v1/execute')
    ).toHaveLength(1);
    expect(
      (await f.client.getSnapshot()).state.orders.filter((order) => order.id === 'android-sale')
    ).toHaveLength(1);
    f.native.request = nativeRequest;
    await f.client.execute({ type: 'save-order', draft: draft() });
    expect(
      f.master.getSnapshot().state.orders.filter((order) => order.id === 'android-sale')
    ).toHaveLength(1);
  });
  it('requires a full key for connection changes and blocks offline writes', async () => {
    const f = await fixture();
    await f.pair();
    await f.client.unlock('android-master-password');
    const saves = vi.mocked(f.native.saveConnection).mock.calls.length;
    await expect(f.client.saveConnection(await f.client.getConnection())).rejects.toThrow(
      'Re-enter'
    );
    expect(vi.mocked(f.native.saveConnection).mock.calls).toHaveLength(saves);
    expect((await f.client.getSnapshot()).session.isAdmin).toBe(true);
    f.setOffline(true);
    const offline = await f.client.refresh();
    expect(offline.sync.connected).toBe(false);
    expect(offline.session.isAdmin).toBe(false);
    const before = vi.mocked(f.native.request).mock.calls.length;
    await expect(f.client.execute({ type: 'save-order', draft: draft() })).rejects.toThrow(
      'Reconnect'
    );
    expect(vi.mocked(f.native.request).mock.calls.length).toBe(before);
    const connection = await f.client.getConnection();
    await expect(f.client.saveConnection(connection)).rejects.toThrow('Re-pair');
    await expect(f.client.saveConnection({ ...connection, rePair: true })).rejects.toThrow(
      'Re-pair'
    );
    f.setOffline(false);
    expect((await f.pair()).sync.connected).toBe(true);
    expect((await f.client.getSnapshot()).session.isAdmin).toBe(false);
  });
  it('locks on backgrounding, rejects a late unlock response and requires a fresh unlock', async () => {
    const f = await fixture();
    await f.pair();
    let release!: () => void, arrived!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const issued = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const request = f.native.request;
    f.native.request = async (input) => {
      const result = await request(input);
      if (input.route === '/v1/unlock') {
        arrived();
        await waiting;
      }
      return result;
    };
    const unlocking = f.client.unlock('android-master-password');
    const rejected = expect(unlocking).rejects.toThrow('background');
    await issued;
    f.client.setActive(false);
    release();
    await rejected;
    expect((await f.client.getSnapshot()).session.isAdmin).toBe(false);
    f.native.request = request;
    f.client.setActive(true);
    const resumed = await f.client.refresh();
    expect(resumed.sync.connected).toBe(true);
    expect(resumed.session.isAdmin).toBe(false);
    expect((await f.client.unlock('android-master-password')).session.isAdmin).toBe(true);
  });
  it('invalidates master sessions across restarts and refuses corrupt snapshots', async () => {
    const f = await fixture();
    await f.pair();
    await f.client.unlock('android-master-password');
    await f.restart();
    expect((await f.client.refresh()).session.isAdmin).toBe(false);
    const state = (await f.client.getSnapshot()).state;
    f.native.request = async () => ({
      body: JSON.stringify({
        state: { schemaVersion: 99 },
        authorityId: 'id',
        serverEpoch: 'epoch',
        passwordSet: true,
        adminValid: true
      })
    });
    const after = await f.client.refresh();
    expect(after.sync.connected).toBe(false);
    expect(after.state).toEqual(state);
  });
  it('shares an authorized report and prints escaped receipts through the native platform', async () => {
    const f = await fixture();
    await f.pair();
    await expect(f.client.exportAudit('2020-01-01', '2040-01-01')).rejects.toThrow('Unlock');
    await f.client.unlock('android-master-password');
    await f.client.exportAudit('2020-01-01', '2040-01-01');
    expect(f.native.shareFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'openpos-sales.csv',
        mime: 'text/csv',
        content: expect.stringContaining('OpenPOS sales report')
      })
    );
    await f.client.execute({
      type: 'save-order',
      draft: { ...draft(), customerName: '<script>bad</script>' }
    });
    await f.client.printReceipt('android-sale');
    expect(f.native.printHtml).toHaveBeenCalledWith({
      html: expect.stringContaining('&lt;script&gt;bad&lt;/script&gt;')
    });
    await expect(f.client.backup()).rejects.toThrow('Windows master');
    await expect(
      f.client.execute({ type: 'start-fresh', confirmation: 'START FRESH', expectedRevision: 0 })
    ).rejects.toThrow('Windows only');
  });
});
