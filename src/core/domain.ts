import { randomUUID } from 'node:crypto';
import type {
  AuditReport,
  BusinessState,
  Command,
  Ingredient,
  Order,
  OrderDraft,
  OrderLine,
  OrderTotals
} from '../shared/types';
import { taxCents } from '../shared/money';
import {
  assert,
  id,
  number,
  object,
  text,
  validateConfig,
  validateDraft,
  validateInventory,
  validateMenuItem,
  validateState
} from './validation';

export const uid = () => randomUUID();
export const quantity = (n: number) => Math.round(n * 10000) / 10000;
export function totals(
  lines: Pick<OrderLine, 'quantity' | 'unitPrice'>[],
  fees: Order['fees'],
  taxRate: number
): OrderTotals {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const feeTotal = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const taxable = subtotal + fees.filter((f) => f.taxable).reduce((sum, f) => sum + f.amount, 0);
  const tax = taxCents(taxable, taxRate);
  const total = subtotal + feeTotal + tax;
  assert(
    [subtotal, feeTotal, tax, total].every(Number.isSafeInteger) && total <= 1e12,
    'This order exceeds the supported total.'
  );
  return { subtotal, fees: feeTotal, tax, total };
}
export const adminCommand = (command: Command) =>
  ['save-menu', 'save-inventory', 'restock', 'save-config'].includes(command.type);
function checkRevision(actual: number, expected: number | undefined) {
  assert(
    expected !== undefined && actual === expected,
    'This record changed on another screen. Refresh and reopen it before saving.'
  );
}
function consumed(order: Order): Map<string, number> {
  const result = new Map<string, number>();
  for (const line of order.lines)
    for (const ingredient of line.recipe)
      result.set(
        ingredient.inventoryId,
        quantity((result.get(ingredient.inventoryId) || 0) + ingredient.quantity * line.quantity)
      );
  return result;
}
function adjustInventory(state: BusinessState, order: Order, at: string) {
  const applied = new Map<string, number>();
  for (const m of state.movements.filter((m) => m.orderId === order.id))
    applied.set(m.inventoryId, quantity((applied.get(m.inventoryId) || 0) - m.quantity));
  const desired =
    order.status === 'completed' &&
    (order as Order & { inventoryTracked?: boolean }).inventoryTracked
      ? consumed(order)
      : new Map<string, number>();
  for (const inventoryId of new Set([...applied.keys(), ...desired.keys()])) {
    const delta = quantity((applied.get(inventoryId) || 0) - (desired.get(inventoryId) || 0));
    if (!delta) continue;
    const inventory = state.inventory.find((i) => i.id === inventoryId);
    assert(
      inventory,
      'An ingredient used by this order no longer exists. Restore the inventory item before changing the order.'
    );
    inventory.quantity = quantity(inventory.quantity + delta);
    inventory.updatedAt = at;
    state.movements.push({
      id: uid(),
      inventoryId,
      quantity: delta,
      reason: order.status === 'cancelled' ? 'cancel' : 'order',
      orderId: order.id,
      note: `${order.status === 'cancelled' ? 'Cancelled' : 'Completed / revised'} order #${order.number}`,
      createdAt: at
    });
  }
}
function canonicalLines(state: BusinessState, draft: OrderDraft, previous?: Order): OrderLine[] {
  return draft.lines.map((line) => {
    const historical = previous?.lines.find(
      (old) =>
        old.id === line.id && old.menuItemId === line.menuItemId && old.variantId === line.variantId
    );
    if (historical) return { ...historical, quantity: line.quantity, notes: line.notes.trim() };
    const item = state.menu.find((i) => i.id === line.menuItemId && i.active);
    assert(item, 'An item is no longer available. Remove it and choose another item.');
    const variant = line.variantId ? item.variants.find((v) => v.id === line.variantId) : undefined;
    assert(!line.variantId || variant, `${item.name}: the selected size is no longer available.`);
    assert(!item.variants.length || variant, `Choose a size for ${item.name}.`);
    // A size recipe overrides the base recipe; an empty size recipe inherits it.
    const recipe: Ingredient[] = variant && variant.recipe.length ? variant.recipe : item.recipe;
    return {
      id: line.id,
      menuItemId: item.id,
      name: item.name,
      ...(variant ? { variantId: variant.id, variantName: variant.name } : {}),
      quantity: line.quantity,
      unitPrice: variant?.price ?? item.price,
      recipe: structuredClone(recipe),
      notes: line.notes.trim()
    };
  });
}
export function applyCommand(
  original: BusinessState,
  command: Command,
  now = new Date().toISOString()
): BusinessState {
  object(command, 'Command');
  text(command.type, 'Command type', 40, false);
  const state = structuredClone(original);
  switch (command.type) {
    case 'save-menu': {
      validateMenuItem(command.item);
      checkRevision(state.revision, command.expectedRevision);
      const item = {
        ...structuredClone(command.item),
        name: command.item.name.trim(),
        updatedAt: now
      };
      const index = state.menu.findIndex((i) => i.id === item.id);
      if (index >= 0) state.menu[index] = item;
      else state.menu.push(item);
      break;
    }
    case 'save-inventory': {
      validateInventory(command.item);
      checkRevision(state.revision, command.expectedRevision);
      const item = {
        ...structuredClone(command.item),
        name: command.item.name.trim(),
        quantity: quantity(command.item.quantity),
        updatedAt: now
      };
      const index = state.inventory.findIndex((i) => i.id === item.id);
      const oldQuantity = index >= 0 ? state.inventory[index].quantity : 0;
      if (index >= 0) state.inventory[index] = item;
      else state.inventory.push(item);
      if (item.quantity !== oldQuantity)
        state.movements.push({
          id: uid(),
          inventoryId: item.id,
          quantity: quantity(item.quantity - oldQuantity),
          reason: 'adjustment',
          note: index >= 0 ? 'Physical stock adjustment' : 'Opening stock',
          createdAt: now
        });
      break;
    }
    case 'restock': {
      id(command.inventoryId);
      number(command.quantity, 'Restock quantity', 0.0001, 1e9);
      text(command.note, 'Restock note', 1000);
      const item = state.inventory.find((i) => i.id === command.inventoryId);
      assert(item, 'Inventory item was not found.');
      item.quantity = quantity(item.quantity + command.quantity);
      item.updatedAt = now;
      state.movements.push({
        id: uid(),
        inventoryId: item.id,
        quantity: quantity(command.quantity),
        reason: 'restock',
        note: command.note.trim() || 'Stock received',
        createdAt: now
      });
      break;
    }
    case 'save-config': {
      validateConfig(command.config);
      checkRevision(state.revision, command.expectedRevision);
      assert(
        command.config.currency === state.config.currency || state.orders.length === 0,
        'Start fresh with a backup before changing currency, so historical orders are not relabelled.'
      );
      state.config = structuredClone(command.config);
      break;
    }
    case 'save-order': {
      validateDraft(command.draft);
      const draft = command.draft;
      const previous = draft.id ? state.orders.find((o) => o.id === draft.id) : undefined;
      if (draft.expectedRevision !== undefined) {
        assert(previous, 'Order was not found.');
        checkRevision(previous.revision, draft.expectedRevision);
        assert(previous.status !== 'cancelled', 'A cancelled order cannot be edited.');
      } else if (previous) {
        const semanticLine = (line: OrderLine) => ({
          id: line.id,
          menuItemId: line.menuItemId,
          variantId: line.variantId,
          quantity: line.quantity,
          notes: line.notes.trim()
        });
        const same =
          previous.status !== 'cancelled' &&
          JSON.stringify(previous.lines.map(semanticLine)) ===
            JSON.stringify(draft.lines.map(semanticLine)) &&
          JSON.stringify(previous.fees.map((f) => f.id).sort()) ===
            JSON.stringify([...draft.feeIds].sort()) &&
          ['fulfillment', 'customerName', 'phone', 'address', 'notes'].every(
            (key) => previous[key as keyof Order] === String(draft[key as keyof OrderDraft]).trim()
          );
        assert(
          same,
          `Order #${previous.number} was already saved. Open it from Orders to make further changes.`
        );
        return original; // Stable cart IDs make an identical creation retry exactly-once, including after restart.
      }
      const lines = canonicalLines(state, draft, previous);
      const fees = draft.feeIds.map((id) => {
        const f =
          previous?.fees.find((f) => f.id === id) || state.config.fees.find((f) => f.id === id);
        assert(f, 'A selected fee was removed. Reopen the order and select its fees again.');
        return structuredClone(f);
      });
      const status =
        previous?.status || (state.config.autoCompleteOrders ? 'completed' : 'in-progress');
      const order: Order & { inventoryTracked?: boolean } = {
        id: previous?.id || draft.id || uid(),
        number:
          previous?.number ||
          state.orders.reduce((maximum, o) => Math.max(maximum, o.number), 0) + 1,
        status,
        fulfillment: draft.fulfillment,
        customerName: draft.customerName.trim(),
        phone: draft.phone.trim(),
        address: draft.address.trim(),
        notes: draft.notes.trim(),
        lines,
        fees,
        taxRate: previous?.taxRate ?? state.config.taxRate,
        totals: totals(lines, fees, previous?.taxRate ?? state.config.taxRate),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
        revision: (previous?.revision || 0) + 1,
        ...(status === 'completed'
          ? {
              completedAt: previous?.completedAt || now,
              inventoryTracked: previous?.inventoryTracked ?? state.config.inventoryEnabled
            }
          : {})
      };
      if (previous) state.orders[state.orders.findIndex((o) => o.id === previous.id)] = order;
      else state.orders.push(order);
      if (status === 'completed') adjustInventory(state, order, now);
      break;
    }
    case 'complete-order':
    case 'cancel-order': {
      id(command.id);
      number(command.expectedRevision, 'Order revision', 1, Number.MAX_SAFE_INTEGER, true);
      const order = state.orders.find((o) => o.id === command.id) as
        (Order & { inventoryTracked?: boolean }) | undefined;
      assert(order, 'Order was not found.');
      checkRevision(order.revision, command.expectedRevision);
      if (command.type === 'complete-order') {
        assert(order.status === 'in-progress', 'Only an in-progress order can be completed.');
        order.status = 'completed';
        order.completedAt = now;
        order.inventoryTracked = state.config.inventoryEnabled;
      } else {
        assert(order.status !== 'cancelled', 'This order is already cancelled.');
        order.status = 'cancelled';
      }
      order.updatedAt = now;
      order.revision++;
      adjustInventory(state, order, now);
      break;
    }
    default:
      throw new Error('This command is not supported.');
  }
  state.revision++;
  validateState(state);
  return state;
}

export function audit(state: BusinessState, from: string, to: string): AuditReport {
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to),
    'Choose a valid start and end date.'
  );
  const start = new Date(`${from}T00:00:00`),
    end = new Date(`${to}T00:00:00`);
  const localDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  assert(
    Number.isFinite(+start) &&
      Number.isFinite(+end) &&
      localDate(start) === from &&
      localDate(end) === to &&
      +start <= +end,
    'Choose a valid date range with the start before the end.'
  );
  end.setDate(end.getDate() + 1);
  const within = (date: string) => +new Date(date) >= +start && +new Date(date) < +end;
  const orders = state.orders.filter((o) => o.status === 'completed' && within(o.completedAt!));
  const report: AuditReport = {
    orderCount: orders.length,
    subtotal: 0,
    fees: 0,
    tax: 0,
    gross: 0,
    averageOrder: 0,
    items: [],
    inventory: [],
    daily: []
  };
  const items = new Map<string, AuditReport['items'][number]>(),
    days = new Map<string, AuditReport['daily'][number]>();
  for (const order of orders) {
    report.subtotal += order.totals.subtotal;
    report.fees += order.totals.fees;
    report.tax += order.totals.tax;
    report.gross += order.totals.total;
    const date = localDate(new Date(order.completedAt!));
    const day = days.get(date) || { date, gross: 0, orders: 0 };
    day.gross += order.totals.total;
    day.orders++;
    days.set(date, day);
    for (const line of order.lines) {
      const key = `${line.menuItemId}:${line.variantId || ''}`;
      const row = items.get(key) || {
        id: key,
        name: `${line.name}${line.variantName ? ` · ${line.variantName}` : ''}`,
        quantity: 0,
        revenue: 0
      };
      row.quantity += line.quantity;
      row.revenue += line.unitPrice * line.quantity;
      items.set(key, row);
    }
  }
  report.averageOrder = orders.length ? Math.round(report.gross / orders.length) : 0;
  report.items = [...items.values()].sort((a, b) => b.quantity - a.quantity);
  report.daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const drawn = new Map<string, number>();
  for (const movement of state.movements)
    if (movement.orderId && within(movement.createdAt))
      drawn.set(
        movement.inventoryId,
        quantity((drawn.get(movement.inventoryId) || 0) - movement.quantity)
      );
  report.inventory = state.inventory
    .map((item) => ({
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity: drawn.get(item.id) || 0
    }))
    .filter((row) => row.quantity !== 0);
  assert(
    [
      report.gross,
      report.subtotal,
      report.fees,
      report.tax,
      ...report.items.map((row) => row.revenue),
      ...report.daily.map((day) => day.gross)
    ].every(Number.isSafeInteger),
    'This report exceeds the supported total. Choose a shorter reporting period.'
  );
  return report;
}
