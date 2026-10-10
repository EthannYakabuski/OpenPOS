import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDemo } from '../../src/core/demo';
import type { MobileConnectionInput, Snapshot } from '../../src/shared/types';

// Electron is only a disposable browser host here. These tests exercise the shared
// Android UI contract; native permissions, plugins and Android WebView need device tests.
let application: ElectronApplication;
let page: Page;
async function launch({
  configured = true,
  connected = true,
  admin = false,
  width = 360,
  height = 800
} = {}) {
  const base = path.resolve('.test-data');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'android-ui-'));
  const demo = createDemo();
  const initial: Snapshot = {
    state: configured ? demo : { ...demo, menu: [], inventory: [], orders: [], movements: [] },
    device: {
      deviceName: 'Test tablet',
      role: 'client',
      defaultTab: 'menu',
      serverUrl: configured ? 'http://192.168.1.10:3210' : '',
      port: 3210,
      syncKey: '',
      clientId: 'android-ui-client',
      registeredClients: []
    },
    session: { isAdmin: admin, passwordSet: true },
    sync: {
      connected: configured && connected,
      message:
        configured && connected ? 'Connected to primary device' : 'Primary device unavailable'
    },
    dataPath: ''
  };
  const preload = `
    const { contextBridge } = require('electron');
    let snapshot = ${JSON.stringify(initial)};
    const demo = ${JSON.stringify(demo)};
    let configured = ${configured};
    let changes = new Set();
    let saved = null;
    let printed = null;
    let exported = false;
    let helped = false;
    const clone = x => JSON.parse(JSON.stringify(x));
    const emit = () => { for (const listener of changes) listener(clone(snapshot)); return clone(snapshot); };
    contextBridge.exposeInMainWorld('openpos', {
      platform: 'android',
      capabilities: { print:true,exportAudit:true,backup:false,dataFolder:false,connectionSettings:true },
      getSnapshot: async () => clone(snapshot),
      getConnection: async () => ({ deviceName:snapshot.device.deviceName,clientId:snapshot.device.clientId,serverUrl:snapshot.device.serverUrl,defaultTab:snapshot.device.defaultTab,configured }),
      saveConnection: async value => { saved = clone(value); configured=true; snapshot.device={...snapshot.device,deviceName:value.deviceName,serverUrl:value.serverUrl,defaultTab:value.defaultTab}; snapshot.state=demo; snapshot.sync={connected:true,message:'Connected to primary device'}; snapshot.session.isAdmin=false; return emit(); },
      onChange: listener => { changes.add(listener); return () => changes.delete(listener); },
      unlock: async password => { if(password!=='test-admin-password') throw Error('Incorrect administrator password.'); snapshot.session.isAdmin=true; return emit(); },
      lock: async () => { snapshot.session.isAdmin=false; return emit(); },
      execute: async () => { throw Error('UI fixture does not implement business mutations.'); },
      getAudit: async () => ({ orderCount:0,subtotal:0,fees:0,tax:0,gross:0,averageOrder:0,items:[],inventory:[],daily:[] }),
      exportAudit: async () => { exported=true; return 'shared Android report'; },
      printReceipt: async id => { printed=id; },
      openHelp: async () => { helped=true; },
      openDataFolder: async () => { throw Error('Unavailable on Android'); },
      backup: async () => { throw Error('Unavailable on Android'); },
      setPassword: async () => { throw Error('Use the primary device'); },
      saveDevice: async () => { throw Error('Use connection settings'); }
    });
    contextBridge.exposeInMainWorld('mobileFixture', {
      saved: () => saved, printed: () => printed, exported: () => exported, helped: () => helped,
      background: () => { snapshot.session.isAdmin=false; emit(); }
    });
  `;
  await fs.writeFile(path.join(directory, 'preload.cjs'), preload);
  await fs.writeFile(
    path.join(directory, 'main.cjs'),
    `
    const { app, BrowserWindow } = require('electron');
    const profile = require('node:path').join(__dirname, 'profile');
    require('node:fs').mkdirSync(profile, { recursive:true });
    app.setPath('userData', profile);
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ width:${width},height:${height},webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,preload:require('node:path').join(__dirname,'preload.cjs')} });
      await win.loadFile(${JSON.stringify(path.resolve('dist/renderer/index.html'))});
    });
    app.on('window-all-closed', () => app.quit());
  `
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [path.join(directory, 'main.cjs')], env });
  page = await application.firstWindow();
  await page.setViewportSize({ width, height });
}
async function noPageOverflow() {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  ).toBe(true);
}
async function noDialogOverflow() {
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual((page.viewportSize()?.width ?? 360) + 1);
  expect(
    await page
      .getByRole('dialog')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
  ).toBe(true);
}
test.afterEach(async () => {
  await application?.close();
});

test('Android phone pairs without exposing a saved key or creating demo business data', async ({}, testInfo) => {
  await launch({ configured: false, connected: false });
  await expect(page.getByRole('heading', { name: 'Connect to your business' })).toBeVisible();
  await expect(page.locator('.menu-card')).toHaveCount(0);
  await expect(page.getByLabel('This client’s ID', { exact: false })).toHaveValue(
    'android-ui-client'
  );
  await expect(page.getByLabel('This client’s ID', { exact: false })).toHaveAttribute(
    'readonly',
    ''
  );
  await expect(page.getByLabel(/^Connection key/)).toHaveAttribute('type', 'password');
  await noPageOverflow();
  await page.screenshot({ path: testInfo.outputPath('android-phone-pairing.png'), fullPage: true });
  await page.getByLabel('Device name', { exact: true }).fill('Owner phone');
  await page.getByLabel('Primary device URL', { exact: false }).fill('http://192.168.1.10:3210');
  await page.getByLabel(/^Connection key/).fill('test-connection-key-at-least-24');
  await page.evaluate(() => window.dispatchEvent(new Event('openpos:locked')));
  await expect(page.getByLabel(/^Connection key/)).toHaveValue('');
  await page.getByLabel(/^Connection key/).fill('test-connection-key-at-least-24');
  await page.getByRole('button', { name: 'Connect to primary device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connection', exact: true })).toBeVisible();
  const saved: MobileConnectionInput = await page.evaluate(() =>
    (window as any).mobileFixture.saved()
  );
  expect(saved).toMatchObject({
    deviceName: 'Owner phone',
    clientId: 'android-ui-client',
    serverUrl: 'http://192.168.1.10:3210',
    syncKey: 'test-connection-key-at-least-24'
  });
  const connection = await page.evaluate(() => window.openpos.getConnection!());
  expect(connection).not.toHaveProperty('syncKey');
  await noPageOverflow();
});

test('offline connection recovery requires explicit re-pairing and a full key', async () => {
  await launch({ connected: false });
  await page.getByRole('button', { name: 'Connection', exact: true }).click();
  await expect(page.getByLabel('Device name', { exact: true })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Unlock administrator', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('checkbox', { name: 'Re-pair this device using the full primary connection key' })
    .check();
  await expect(page.getByLabel('Device name', { exact: true })).toBeEnabled();
  await expect(page.getByLabel(/^Connection key/)).toHaveAttribute('required', '');
  await noDialogOverflow();
  await page.getByLabel(/^Connection key/).fill('new-connection-key-at-least-24');
  await page.getByRole('button', { name: 'Save connection', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).mobileFixture.saved())).toMatchObject({
    rePair: true,
    syncKey: 'new-connection-key-at-least-24'
  });
});

test('phone order switch preserves touch selections and tablet shows menu beside ticket', async ({}, testInfo) => {
  await launch();
  const item = page.locator('.menu-card-add').filter({ hasText: 'Canned Pepsi' });
  await item.scrollIntoViewIfNeeded();
  const bounds = (await item.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.getByRole('button', { name: /Current order 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Current order', exact: true })).toBeVisible();
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeEnabled();
  await noPageOverflow();
  await page.screenshot({ path: testInfo.outputPath('android-phone-ticket.png'), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.locator('.menu-pane')).toBeVisible();
  await expect(page.locator('.cart-panel')).toBeVisible();
  const menu = (await page.locator('.menu-pane').boundingBox())!;
  const cart = (await page.locator('.cart-panel').boundingBox())!;
  expect(menu.x + menu.width).toBeLessThanOrEqual(cart.x + 1);
  await noPageOverflow();
  await page.screenshot({ path: testInfo.outputPath('android-tablet-menu.png') });
});

test('Android administrator controls hide desktop-only actions and backgrounding closes private forms', async ({}, testInfo) => {
  await launch({ admin: true });
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start fresh', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create backup', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open data folder', exact: true })).toHaveCount(0);
  await noDialogOverflow();
  await page.getByRole('tab', { name: 'This device', exact: true }).click();
  await expect(page.getByLabel('Connection mode', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Connection settings', exact: true })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await expect(page.getByLabel('New password', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sales at a glance' })).toBeVisible();
  await noPageOverflow();
  await page.screenshot({ path: testInfo.outputPath('android-phone-audit.png'), fullPage: true });
  await page.getByRole('button', { name: 'Export report', exact: true }).click();
  expect(await page.evaluate(() => (window as any).mobileFixture.exported())).toBe(true);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await noDialogOverflow();
  await page.evaluate(() => {
    (window as any).mobileFixture.background();
    window.dispatchEvent(new Event('openpos:locked'));
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Audit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connection', exact: true })).toBeVisible();
});
