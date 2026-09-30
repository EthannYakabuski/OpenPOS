import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { OpenPOSService } from '../src/main/service';
import { JSONStore, atomicJSON, readJSON } from '../src/core/storage';
import type { BusinessState, OrderDraft } from '../src/shared/types';

const folders: string[] = [],
  services: OpenPOSService[] = [];
async function service() {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'openpos-test-'));
  folders.push(folder);
  const app = new OpenPOSService(folder);
  services.push(app);
  await app.init();
  return app;
}
const draft = (): OrderDraft => ({
  id: 'cart-persist',
  lines: [
    {
      id: 'line-a',
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
  customerName: 'Persistence test',
  phone: '',
  address: '',
  notes: ''
});
async function until(check: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 50));
  expect(check()).toBe(true);
}
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.close()));
  await Promise.all(folders.splice(0).map((f) => fs.rm(f, { recursive: true, force: true })));
});

describe('Local persistence and controls', () => {
  it('persists orders, password hashes, inventory and NDJSON across restart', async () => {
    let app = await service();
    const folder = app.dataPath;
    await app.setPassword('correct horse battery');
    await app.execute({ type: 'save-order', draft: draft() });
    const order = app.getSnapshot().state.orders.find((o) => o.id === 'cart-persist')!;
    await app.execute({ type: 'complete-order', id: order.id, expectedRevision: order.revision });
    const stock = app.getSnapshot().state.inventory.find((i) => i.id === 'snickers')!.quantity;
    await app.close();
    app = new OpenPOSService(folder);
    services.push(app);
    await app.init();
    expect(app.getSnapshot().session).toEqual({ isAdmin: false, passwordSet: true });
    expect(app.getSnapshot().state.orders.find((o) => o.id === order.id)?.status).toBe('completed');
    expect(app.getSnapshot().state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(
      stock
    );
    await app.execute({ type: 'save-order', draft: draft() });
    expect(app.getSnapshot().state.orders.filter((o) => o.id === order.id)).toHaveLength(1);
    expect(app.getSnapshot().state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(
      stock
    );
    const auth = await fs.readFile(path.join(folder, 'auth.json'), 'utf8');
    expect(auth).not.toContain('correct horse battery');
    expect(JSON.parse(auth).hash).toHaveLength(128);
    const events = (await fs.readFile(path.join(folder, 'events.ndjson'), 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events.some((e) => e.type === 'complete-order')).toBe(true);
  });
  it('enforces admin for shared settings, inventory, audit, backup and device settings', async () => {
    const app = await service();
    await app.setPassword('admin-password');
    await app.lock();
    const snapshot = app.getSnapshot();
    await expect(
      app.execute({
        type: 'save-config',
        config: snapshot.state.config,
        expectedRevision: snapshot.state.revision
      })
    ).rejects.toThrow('Unlock');
    await expect(
      app.execute({ type: 'restock', inventoryId: 'snickers', quantity: 1, note: '' })
    ).rejects.toThrow('Unlock');
    await expect(app.saveDevice(snapshot.device)).rejects.toThrow('Unlock');
    await expect(app.getAudit('2026-01-01', '2026-12-31')).rejects.toThrow('Unlock');
    await expect(app.backup()).rejects.toThrow('Unlock');
    await expect(app.unlock('wrong')).rejects.toThrow('incorrect');
    await app.unlock('admin-password');
    expect(app.getSnapshot().session.isAdmin).toBe(true);
    await expect(app.setPassword('new-password', 'wrong')).rejects.toThrow('current');
    await app.setPassword('new-password', 'admin-password');
    await app.lock();
    await expect(app.unlock('admin-password')).rejects.toThrow('incorrect');
    await app.unlock('new-password');
  });
  it('serializes simultaneous edits and rejects the loser as stale', async () => {
    const app = await service();
    const snapshot = app.getSnapshot();
    const config = snapshot.state.config;
    const results = await Promise.allSettled([
      app.execute({
        type: 'save-config',
        config: { ...config, businessName: 'One' },
        expectedRevision: snapshot.state.revision
      }),
      app.execute({
        type: 'save-config',
        config: { ...config, businessName: 'Two' },
        expectedRevision: snapshot.state.revision
      })
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(app.getSnapshot().state.config.businessName).toBe('One');
  });
  it('hot reloads valid manual menu edits and retains rejected text without losing a concurrent order', async () => {
    const app = await service();
    const file = path.join(app.dataPath, 'menu.json');
    const menu = app.getSnapshot().state.menu;
    menu[0].name = 'Manual pizza';
    await fs.writeFile(file, '\uFEFF' + JSON.stringify(menu));
    await app.execute({ type: 'save-order', draft: draft() });
    await until(() => app.getSnapshot().state.menu[0].name === 'Manual pizza');
    expect(app.getSnapshot().state.orders.some((o) => o.id === 'cart-persist')).toBe(true);
    await fs.writeFile(file, '{ malformed');
    await until(() => Boolean(app.getSnapshot().warning?.includes('not applied')));
    expect(app.getSnapshot().state.menu[0].name).toBe('Manual pizza');
    const files = await fs.readdir(path.join(app.dataPath, 'backups'));
    expect(files.some((f) => f.startsWith('rejected-menu-'))).toBe(true);
    await fs.writeFile(file, JSON.stringify(menu));
    await until(() => !app.getSnapshot().warning);
  });
  it('saves a complete backup before resetting business history and requires exact confirmation', async () => {
    const app = await service();
    const before = app.getSnapshot().state;
    await expect(
      app.execute({ type: 'start-fresh', confirmation: 'yes', expectedRevision: before.revision })
    ).rejects.toThrow('START FRESH');
    await app.execute({
      type: 'start-fresh',
      confirmation: 'START FRESH',
      expectedRevision: before.revision
    });
    const state = app.getSnapshot().state;
    expect(state.orders).toHaveLength(0);
    expect(state.movements).toHaveLength(0);
    expect(state.inventory.every((i) => i.quantity === 0)).toBe(true);
    expect(state.menu).toEqual(before.menu);
    const files = await fs.readdir(path.join(app.dataPath, 'backups'));
    const backup = await readJSON<BusinessState>(path.join(app.dataPath, 'backups', files[0]));
    expect(backup.orders).toEqual(before.orders);
  });
  it('rejects a second writer to the same data folder', async () => {
    const app = await service();
    const second = new OpenPOSService(app.dataPath);
    await expect(second.init()).rejects.toThrow('already open');
  });
});

describe('Recovery safeguards', () => {
  it('rejects oversized JSON before touching a previously saved file', async () => {
    const app = await service();
    const file = path.join(app.dataPath, 'capacity-test.json');
    await atomicJSON(file, { original: true });
    await expect(atomicJSON(file, { oversized: 'x'.repeat(200) }, 100)).rejects.toThrow(
      'safety limit'
    );
    expect(await readJSON(file)).toEqual({ original: true });
  });
  it('replays the committed transaction journal after an interrupted multi-file save', async () => {
    const app = await service();
    const state = app.getSnapshot().state;
    const folder = app.dataPath;
    await app.close();
    state.config.businessName = 'Recovered safely';
    state.revision++;
    await atomicJSON(path.join(folder, 'transaction.json'), {
      state,
      event: {
        id: 'recovery-test',
        type: 'test-recovery',
        createdAt: new Date().toISOString(),
        revision: state.revision
      }
    });
    await fs.writeFile(path.join(folder, 'config.json'), '{}');
    const store = new JSONStore(folder);
    const recovered = await store.init();
    expect(recovered.config.businessName).toBe('Recovered safely');
    expect(recovered.revision).toBe(state.revision);
    await expect(fs.access(path.join(folder, 'transaction.json'))).rejects.toThrow();
    store.close();
  });
  it('refuses incomplete or corrupted business files instead of reseeding over them', async () => {
    const app = await service();
    const folder = app.dataPath;
    await app.close();
    await fs.unlink(path.join(folder, 'inventory.json'));
    const store = new JSONStore(folder);
    await expect(store.init()).rejects.toThrow('incomplete');
    expect((await readJSON<any[]>(path.join(folder, 'orders.json'))).length).toBeGreaterThan(0);
  });
  it('preserves a malformed menu on startup and releases the data lock after failure', async () => {
    const app = await service();
    const folder = app.dataPath;
    await app.close();
    const file = path.join(folder, 'menu.json');
    await fs.writeFile(file, '{ do not overwrite this');
    const failed = new OpenPOSService(folder);
    await expect(failed.init()).rejects.toThrow();
    expect(await fs.readFile(file, 'utf8')).toBe('{ do not overwrite this');
    await expect(fs.access(path.join(folder, 'instance.lock'))).rejects.toThrow();
  });
  it('never rewrites a newer external editor save while committing an already-read menu import', async () => {
    const app = await service();
    const folder = app.dataPath;
    await app.close();
    const store = new JSONStore(folder);
    const state = await store.init();
    const first = structuredClone(state);
    first.revision++;
    first.menu[0].name = 'First editor save';
    const latest = structuredClone(first.menu);
    latest[0].name = 'Second editor save';
    const file = path.join(folder, 'menu.json');
    await fs.writeFile(file, JSON.stringify(latest));
    await store.commit(first, 'manual-menu-edit');
    expect((await readJSON<any[]>(file))[0].name).toBe('Second editor save');
    store.close();
  });
});
