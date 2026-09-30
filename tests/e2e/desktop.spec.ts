import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Snapshot } from '../../src/shared/types';

let application: ElectronApplication;
let page: Page;
let directory: string;
const snapshot = () => page.evaluate(() => window.openpos.getSnapshot());
const launchOptions = () =>
  process.env.OPENPOS_TEST_EXECUTABLE
    ? { executablePath: process.env.OPENPOS_TEST_EXECUTABLE, args: [] as string[] }
    : { args: [path.resolve('.')] };

test.beforeEach(async () => {
  const root = path.resolve('.test-data');
  await fs.mkdir(root, { recursive: true });
  directory = await fs.mkdtemp(path.join(root, 'desktop-'));
  const env = Object.fromEntries(
    Object.entries({ ...process.env, OPENPOS_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ ...launchOptions(), env });
  page = await application.firstWindow();
  await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeVisible();
});
test.afterEach(async () => {
  await application?.close();
});

test('touch ordering, completion and completed-order editing reconcile inventory', async () => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 850 });
  await expect(page.getByRole('heading', { name: 'Current order' })).toBeVisible();
  const before = await snapshot();
  const pepsiBefore = before.state.inventory.find((item) => item.id === 'pepsi')!.quantity;
  // Dispatch a real Chromium touch gesture rather than invoking a component handler.
  const pepsi = page.locator('.menu-card-add').filter({ hasText: 'Canned Pepsi' });
  await pepsi.scrollIntoViewIfNeeded();
  const bounds = (await pepsi.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }]
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.cart-line')).toHaveCount(1);
  await page.locator('.menu-card-add').filter({ hasText: 'Margherita pizza' }).click();
  await page.getByRole('button', { name: /Small · 10 inch/ }).click();
  await page.getByText('Customer & order notes', { exact: false }).click();
  await page.getByLabel('Customer name', { exact: true }).fill('E2E customer');
  await page.getByRole('button', { name: 'Order', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Order saved' })).toBeVisible();
  const created = (await snapshot()).state.orders.find(
    (order) => order.customerName === 'E2E customer'
  )!;
  expect(created.totals).toEqual({ subtotal: 1424, fees: 0, tax: 185, total: 1609 });
  await application.evaluate(({ app }) => {
    app.once('browser-window-created', (_event, receiptWindow) => {
      receiptWindow.webContents.print = (_options, callback) => {
        void receiptWindow.webContents.executeJavaScript('document.body.innerText').then((text) => {
          (globalThis as any).__printedReceipt = text;
          callback?.(true, '');
        });
      };
    });
  });
  await page.getByRole('button', { name: 'Print receipt', exact: true }).click();
  await expect
    .poll(() => application.evaluate(() => (globalThis as any).__printedReceipt))
    .toContain('$16.09');
  expect(created.status).toBe('in-progress');
  expect((await snapshot()).state.inventory.find((item) => item.id === 'pepsi')!.quantity).toBe(
    pepsiBefore
  );
  await page.getByRole('button', { name: 'Next order' }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: /^Orders/ })
    .click();
  const card = page.locator('.order-card').filter({ hasText: 'E2E customer' });
  await card.getByRole('button', { name: 'Completed', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(card).toHaveClass(/completed/);
  expect((await snapshot()).state.inventory.find((item) => item.id === 'pepsi')!.quantity).toBe(
    pepsiBefore - 1
  );
  await card.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByRole('button', { name: 'Add one Canned Pepsi', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Order saved' })).toBeVisible();
  const edited = (await snapshot()).state.orders.find((order) => order.id === created.id)!;
  expect(edited.status).toBe('completed');
  expect(edited.totals.total).toBe(1863);
  expect((await snapshot()).state.inventory.find((item) => item.id === 'pepsi')!.quantity).toBe(
    pepsiBefore - 2
  );
  await page.getByRole('button', { name: 'Next order' }).click();
  await page.screenshot({ path: 'test-results/menu-desktop.png' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('button', { name: 'Order', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/menu-tablet.png' });
  expect(errors).toEqual([]);
});

test('menu dialog persists and manual JSON menu edits refresh the screen', async () => {
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add menu item' });
  await editor.getByLabel('Item name', { exact: true }).fill('Espresso test');
  await editor.getByLabel('Category', { exact: true }).fill('Drinks');
  await editor.getByLabel('Base price', { exact: false }).fill('2.75');
  await editor.getByRole('button', { name: 'Save menu item' }).click();
  await expect(editor).not.toBeVisible();
  await page.getByLabel('Search menu').fill('Espresso test');
  await expect(page.locator('.menu-card-add').filter({ hasText: 'Espresso test' })).toBeVisible();
  const stored = JSON.parse(
    await fs.readFile(path.join(directory, 'menu.json'), 'utf8')
  ) as Snapshot['state']['menu'];
  const item = stored.find((row) => row.name === 'Espresso test')!;
  expect(item.price).toBe(275);
  item.name = 'Espresso updated';
  item.price = 300;
  await fs.writeFile(path.join(directory, 'menu.json'), JSON.stringify(stored, null, 2));
  await page.getByLabel('Search menu').fill('Espresso updated');
  await expect(
    page.locator('.menu-card-add').filter({ hasText: 'Espresso updated' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Edit Espresso updated', exact: true }).click();
  await expect(page.getByLabel('Base price', { exact: false })).toHaveValue('3.00');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await application.close();
  const env = Object.fromEntries(
    Object.entries({ ...process.env, OPENPOS_DATA_DIR: directory }).filter(
      (entry): entry is [string, string] => entry[1] !== undefined
    )
  );
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ ...launchOptions(), env });
  page = await application.firstWindow();
  await expect(page.getByRole('button', { name: 'Add item', exact: true })).toBeVisible();
  expect((await snapshot()).state.menu.find((row) => row.id === item.id)?.price).toBe(300);
});

test('administrator password gates reporting and persistent configuration', async () => {
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByRole('tab', { name: 'Security', exact: true }).click();
  await page.getByLabel('New password', { exact: false }).first().fill('test-password-123');
  await page.getByLabel('Confirm new password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(page.getByText('Administrator password saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Lock administrator', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Audit', exact: true })
  ).toHaveCount(0);
  const refusal = await page.evaluate(async () => {
    try {
      await window.openpos.getAudit('2026-01-01', '2026-12-31');
      return '';
    } catch (error) {
      return String(error);
    }
  });
  expect(refusal).toMatch(/administrator/i);
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Administrator password', { exact: true }).fill('test-password-123');
  await page.getByRole('button', { name: 'Unlock administrator', exact: true }).click();
  await expect(
    page.getByText('Administrator unlocked on this device', { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Audit', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Sales|Audit|Business/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click();
  const exportPath = path.join(directory, 'sales.csv');
  await application.evaluate(({ dialog }, filename) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
  }, exportPath);
  await page.getByRole('button', { name: 'Export report', exact: true }).click();
  await expect
    .poll(async () => {
      try {
        return await fs.readFile(exportPath, 'utf8');
      } catch {
        return '';
      }
    })
    .toContain('Gross including tax');
  await page.screenshot({ path: 'test-results/audit-desktop.png' });
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined');
  const hashFile = await fs.readFile(path.join(directory, 'auth.json'), 'utf8');
  expect(hashFile).not.toContain('test-password-123');
});

test('automatic completion and start-fresh backup are available in configuration', async () => {
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await page.getByLabel('Auto Complete Orders', { exact: false }).check();
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.menu-card-add').filter({ hasText: 'Snickers bar' }).click();
  const initial = await snapshot();
  await page.getByRole('button', { name: 'Order', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Order saved' })).toBeVisible();
  const after = await snapshot();
  const order = after.state.orders.find(
    (row) => !initial.state.orders.some((old) => old.id === row.id)
  )!;
  expect(order.status).toBe('completed');
  expect(after.state.inventory.find((item) => item.id === 'snickers')!.quantity).toBe(
    initial.state.inventory.find((item) => item.id === 'snickers')!.quantity - 1
  );
  await page.getByRole('button', { name: 'Next order' }).click();
  await page.getByRole('button', { name: 'Configuration', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start fresh', exact: true })).toBeDisabled();
  await page.getByLabel('Type START FRESH to confirm').fill('START FRESH');
  await page.getByRole('button', { name: 'Start fresh', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const result = await snapshot();
  expect(result.state.orders).toHaveLength(0);
  expect(result.state.menu.length).toBeGreaterThan(0);
  expect(result.state.inventory.every((item) => item.quantity === 0)).toBe(true);
  const backups = await fs.readdir(path.join(directory, 'backups'));
  expect(backups.filter((file) => file.endsWith('.json')).length).toBeGreaterThan(0);
});

test('bundled help opens an external local handbook and the desktop stays isolated', async () => {
  await application.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      (globalThis as any).__helpURL = url;
    };
  });
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect
    .poll(() => application.evaluate(() => (globalThis as any).__helpURL))
    .toMatch(/^file:\/\/.*help\.html$/);
  const help = await fs.readFile(path.join(directory, 'help', 'help.html'), 'utf8');
  expect(help).toContain('Business handbook');
  expect(await fs.stat(path.join(directory, 'help', 'style.css'))).toBeTruthy();
  expect(
    await page.evaluate(() => ({
      require: typeof (window as any).require,
      process: typeof (window as any).process
    }))
  ).toEqual({ require: 'undefined', process: 'undefined' });
  expect(await page.evaluate(() => Object.keys(window.openpos).sort())).not.toContain(
    'ipcRenderer'
  );
});

test('inventory receiving and custom recipe setup work from the administrator dialogs', async () => {
  await page.getByRole('button', { name: 'Inventory', exact: true }).click();
  await page.getByRole('button', { name: 'New item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Test brownie stock');
  await page.getByLabel('Quantity on hand', { exact: false }).fill('10');
  await page.getByRole('button', { name: 'Save inventory item' }).click();
  const row = page.locator('.inventory-row').filter({ hasText: 'Test brownie stock' });
  await row.getByRole('button', { name: 'Receive', exact: true }).click();
  await page.getByLabel('Quantity received (each)', { exact: true }).fill('12');
  await page.getByLabel('Purchase note (optional)', { exact: true }).fill('Owner delivery');
  await page.getByRole('button', { name: 'Receive stock', exact: true }).click();
  await expect(row.locator('.stock-count strong')).toHaveText('22');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const stock = (await snapshot()).state.inventory.find(
    (item) => item.name === 'Test brownie stock'
  )!;
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByLabel('Item name', { exact: true }).fill('Test brownie');
  await page.getByLabel('Base price', { exact: false }).fill('3.50');
  await page.getByRole('button', { name: 'Add inventory ingredient' }).click();
  await page.getByRole('combobox', { name: 'Inventory item', exact: true }).selectOption(stock.id);
  await page.getByRole('button', { name: 'Save menu item' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = (await snapshot()).state.menu.find((item) => item.name === 'Test brownie')!;
  expect(saved.recipe).toEqual([{ inventoryId: stock.id, quantity: 1 }]);
  expect(saved.price).toBe(350);
});
