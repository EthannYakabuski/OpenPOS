import type {
  BusinessConfig,
  BusinessState,
  DeviceConfig,
  InventoryItem,
  MenuItem,
  Order,
  OrderDraft
} from '../shared/types';
import { taxCents } from '../shared/money';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ValidationError(message);
}
export function object(value: unknown, name: string): asserts value is Record<string, any> {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${name} must be an object.`
  );
}
export function text(
  value: unknown,
  name: string,
  max = 500,
  allowEmpty = true
): asserts value is string {
  assert(
    typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0),
    `${name} must be ${allowEmpty ? 'text' : 'non-empty text'} (up to ${max} characters).`
  );
}
export function number(
  value: unknown,
  name: string,
  min = 0,
  max = 1e9,
  integer = false
): asserts value is number {
  assert(
    typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max &&
      (!integer || Number.isSafeInteger(value)),
    `${name} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}.`
  );
}
export function array(value: unknown, name: string, max = 50000): asserts value is any[] {
  assert(
    Array.isArray(value) && value.length <= max,
    `${name} must be a list of at most ${max} entries.`
  );
}
export function id(value: unknown, name = 'ID'): asserts value is string {
  text(value, name, 100, false);
  assert(
    /^[a-zA-Z0-9_-]+$/.test(value),
    `${name} must contain letters, digits, underscores or hyphens only.`
  );
}
export function bool(value: unknown, name: string): asserts value is boolean {
  assert(typeof value === 'boolean', `${name} must be true or false.`);
}
export function date(value: unknown, name: string): asserts value is string {
  text(value, name, 40, false);
  assert(Number.isFinite(Date.parse(value)), `${name} must be a valid date.`);
}
export function unique(items: { id: string }[], name: string) {
  assert(new Set(items.map((x) => x.id)).size === items.length, `${name} contains duplicate IDs.`);
}
export function recipe(value: unknown) {
  array(value, 'Recipe', 100);
  for (const x of value) {
    object(x, 'Ingredient');
    id(x.inventoryId, 'Ingredient inventory ID');
    number(x.quantity, 'Ingredient quantity', 0.0001, 1e6);
    assert(
      Math.abs(x.quantity * 1e4 - Math.round(x.quantity * 1e4)) < 0.000001,
      'Ingredient quantities support up to four decimal places.'
    );
  }
  assert(
    new Set(value.map((x) => x.inventoryId)).size === value.length,
    'A recipe may reference each inventory item only once.'
  );
}
export function validateMenuItem(value: unknown): asserts value is MenuItem {
  object(value, 'Menu item');
  id(value.id);
  text(value.name, 'Item name', 100, false);
  text(value.category, 'Category', 60, false);
  text(value.description, 'Description', 1000);
  number(value.price, 'Price in cents', 0, 1e9, true);
  text(value.color, 'Item color', 40);
  text(value.icon, 'Icon', 80);
  bool(value.active, 'Active');
  date(value.updatedAt, 'Updated date');
  recipe(value.recipe);
  array(value.variants, 'Variants', 100);
  for (const v of value.variants) {
    object(v, 'Variant');
    id(v.id);
    text(v.name, 'Variant name', 100, false);
    number(v.price, 'Variant price in cents', 0, 1e9, true);
    recipe(v.recipe);
  }
  unique(value.variants, 'Variants');
}
export function validateInventory(value: unknown): asserts value is InventoryItem {
  object(value, 'Inventory item');
  id(value.id);
  text(value.name, 'Inventory name', 100, false);
  text(value.unit, 'Inventory unit', 30, false);
  number(value.quantity, 'Inventory quantity', -1e9, 1e9);
  number(value.lowStockAt, 'Low stock threshold');
  date(value.updatedAt, 'Updated date');
}
export function fee(value: unknown) {
  object(value, 'Fee');
  id(value.id);
  text(value.name, 'Fee name', 100, false);
  number(value.amount, 'Fee in cents', 0, 1e9, true);
  bool(value.taxable, 'Taxable fee');
}
export function validateConfig(value: unknown): asserts value is BusinessConfig {
  object(value, 'Business configuration');
  text(value.businessName, 'Business name', 120, false);
  assert(
    ['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'NZD'].includes(value.currency),
    'Choose CAD, USD, EUR, GBP, AUD or NZD. OpenPOS currently supports these two-decimal currencies.'
  );
  number(value.taxRate, 'Tax percentage', 0, 100);
  assert(
    Math.abs(value.taxRate * 1e4 - Math.round(value.taxRate * 1e4)) < 0.000001,
    'Tax rate supports up to four decimal places.'
  );
  bool(value.autoCompleteOrders, 'Auto complete');
  bool(value.inventoryEnabled, 'Inventory enabled');
  text(value.receiptFooter, 'Receipt footer', 500);
  array(value.fees, 'Fees', 100);
  value.fees.forEach(fee);
  unique(value.fees, 'Fees');
}
export function validateDraft(value: unknown): asserts value is OrderDraft {
  object(value, 'Order');
  if (value.id !== undefined) id(value.id);
  if (value.expectedRevision !== undefined)
    number(value.expectedRevision, 'Order revision', 0, Number.MAX_SAFE_INTEGER, true);
  assert(
    ['takeout', 'delivery', 'dine-in'].includes(value.fulfillment),
    'Choose takeout, delivery or dine-in.'
  );
  text(value.customerName, 'Customer name', 120);
  text(value.phone, 'Phone', 60);
  text(value.address, 'Address', 300);
  text(value.notes, 'Order notes', 2000);
  array(value.lines, 'Order lines', 500);
  assert(value.lines.length > 0, 'Add at least one item to the order.');
  for (const line of value.lines) {
    object(line, 'Order line');
    id(line.id, 'Line ID');
    id(line.menuItemId, 'Menu item ID');
    if (line.variantId !== undefined) id(line.variantId, 'Variant ID');
    number(line.quantity, 'Order quantity', 1, 10000, true);
    text(line.notes, 'Line notes', 1000);
  }
  unique(value.lines, 'Order lines');
  array(value.feeIds, 'Selected fees', 100);
  value.feeIds.forEach((x) => id(x, 'Fee ID'));
  assert(
    new Set(value.feeIds).size === value.feeIds.length,
    'The same fee cannot be selected twice.'
  );
}
export function validateOrder(value: unknown): asserts value is Order {
  object(value, 'Stored order');
  id(value.id);
  number(value.number, 'Order number', 1, Number.MAX_SAFE_INTEGER, true);
  assert(['in-progress', 'completed', 'cancelled'].includes(value.status), 'Invalid order status.');
  validateDraft({ ...value, feeIds: [] });
  for (const line of value.lines) {
    text(line.name, 'Line name', 100, false);
    if (line.variantName !== undefined) text(line.variantName, 'Variant name', 100);
    number(line.unitPrice, 'Unit price in cents', 0, 1e9, true);
    recipe(line.recipe);
  }
  array(value.fees, 'Fees', 100);
  value.fees.forEach(fee);
  unique(value.fees, 'Order fees');
  number(value.taxRate, 'Tax percentage', 0, 100);
  object(value.totals, 'Order totals');
  for (const k of ['subtotal', 'fees', 'tax', 'total'])
    number(value.totals[k], k, 0, Number.MAX_SAFE_INTEGER, true);
  date(value.createdAt, 'Creation date');
  date(value.updatedAt, 'Updated date');
  if (value.completedAt !== undefined) date(value.completedAt, 'Completion date');
  if (value.status === 'completed')
    assert(value.completedAt, 'Completed order needs a completion date.');
  number(value.revision, 'Order revision', 1, Number.MAX_SAFE_INTEGER, true);
  if (value.inventoryTracked !== undefined) bool(value.inventoryTracked, 'Inventory tracked');
}
export function validateState(value: unknown): asserts value is BusinessState {
  object(value, 'Business data');
  assert(value.schemaVersion === 1, 'This data version is not supported.');
  number(value.revision, 'Data revision', 0, Number.MAX_SAFE_INTEGER, true);
  array(value.menu, 'Menu');
  value.menu.forEach(validateMenuItem);
  unique(value.menu, 'Menu');
  array(value.inventory, 'Inventory');
  value.inventory.forEach(validateInventory);
  unique(value.inventory, 'Inventory');
  array(value.orders, 'Orders');
  value.orders.forEach(validateOrder);
  unique(value.orders, 'Orders');
  assert(
    new Set(value.orders.map((o: Order) => o.number)).size === value.orders.length,
    'Orders contain duplicate ticket numbers.'
  );
  validateConfig(value.config);
  array(value.movements, 'Inventory movements', 1000000);
  const stocks = new Set(value.inventory.map((x: InventoryItem) => x.id));
  for (const order of value.orders) {
    const subtotal = order.lines.reduce((s: number, l: any) => s + l.quantity * l.unitPrice, 0);
    const fees = order.fees.reduce((s: number, f: any) => s + f.amount, 0);
    const taxable =
      subtotal +
      order.fees.filter((f: any) => f.taxable).reduce((s: number, f: any) => s + f.amount, 0);
    const tax = taxCents(taxable, order.taxRate);
    assert(
      Math.abs(order.taxRate * 1e4 - Math.round(order.taxRate * 1e4)) < 0.000001,
      'Stored tax rate supports up to four decimal places.'
    );
    assert(
      order.totals.subtotal === subtotal &&
        order.totals.fees === fees &&
        order.totals.tax === tax &&
        order.totals.total === subtotal + fees + tax &&
        order.totals.total <= 1e12,
      `Order #${order.number} contains inconsistent or unsupported totals.`
    );
  }
  for (const m of value.menu)
    for (const r of [m.recipe, ...m.variants.map((v: any) => v.recipe)])
      for (const ingredient of r)
        assert(
          stocks.has(ingredient.inventoryId),
          `${m.name} references an unknown inventory item.`
        );
  const orders = new Set(value.orders.map((o: Order) => o.id));
  for (const order of value.orders)
    for (const line of order.lines)
      for (const ingredient of line.recipe)
        assert(
          stocks.has(ingredient.inventoryId),
          `Order #${order.number} references an unknown inventory item.`
        );
  for (const m of value.movements) {
    object(m, 'Inventory movement');
    id(m.id);
    id(m.inventoryId);
    assert(stocks.has(m.inventoryId), 'An inventory movement references an unknown stock item.');
    number(m.quantity, 'Movement quantity', -1e9, 1e9);
    assert(
      ['restock', 'order', 'adjustment', 'cancel'].includes(m.reason),
      'Unknown inventory movement reason.'
    );
    if (m.orderId !== undefined) {
      id(m.orderId);
      assert(orders.has(m.orderId), 'An inventory movement references an unknown order.');
    }
    if (m.reason === 'order' || m.reason === 'cancel')
      assert(m.orderId, 'Order stock movements must reference their order.');
    text(m.note, 'Movement note', 1000);
    date(m.createdAt, 'Movement date');
  }
  unique(value.movements, 'Inventory movements');
}
export function validateDevice(value: unknown): asserts value is DeviceConfig {
  object(value, 'Device configuration');
  text(value.deviceName, 'Device name', 100, false);
  assert(['standalone', 'master', 'client'].includes(value.role), 'Invalid device role.');
  assert(['menu', 'orders'].includes(value.defaultTab), 'Invalid default tab.');
  text(value.serverUrl, 'Server URL', 500);
  number(value.port, 'Network port', 1024, 65535, true);
  text(value.syncKey, 'Sync key', 200);
  id(value.clientId, 'Client ID');
  array(value.registeredClients, 'Registered clients', 100);
  for (const c of value.registeredClients) {
    object(c, 'Registered client');
    id(c.id);
    text(c.name, 'Client name', 100, false);
  }
  unique(value.registeredClients, 'Registered clients');
  if (value.role !== 'standalone')
    assert(value.syncKey.length >= 24, 'Use a sync key containing at least 24 characters.');
  if (value.role === 'client') {
    let url: URL;
    try {
      url = new URL(value.serverUrl);
    } catch {
      throw new ValidationError('Enter the master URL, for example http://192.168.1.10:3210.');
    }
    assert(
      url.protocol === 'http:' &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        (url.pathname === '/' || url.pathname === ''),
      'Master URL must be an HTTP origin without credentials, path or query.'
    );
  }
}
