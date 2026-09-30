import { describe, expect, it } from 'vitest';
import { createDemo } from '../src/core/demo';
import { applyCommand, audit, totals } from '../src/core/domain';
import { validateState } from '../src/core/validation';
import { taxCents } from '../src/shared/money';
import type { BusinessState, Order, OrderDraft } from '../src/shared/types';

const now = '2026-09-30T16:00:00.000Z';
function empty(): BusinessState {
  const state = createDemo(new Date(now));
  state.orders = [];
  state.movements = [];
  state.inventory.forEach((i) => {
    i.quantity = 100;
  });
  return state;
}
function draft(quantity = 1): OrderDraft {
  return {
    id: 'cart-123',
    lines: [
      {
        id: 'line-123',
        menuItemId: 'snickers-bar',
        quantity,
        name: 'Untrusted name',
        unitPrice: 1,
        recipe: [],
        notes: ''
      }
    ],
    feeIds: [],
    fulfillment: 'takeout',
    customerName: 'Test',
    phone: '',
    address: '',
    notes: ''
  };
}
function edit(order: Order, qty: number): OrderDraft {
  return {
    ...order,
    expectedRevision: order.revision,
    lines: order.lines.map((l) => ({ ...l, quantity: qty })),
    feeIds: order.fees.map((f) => f.id)
  };
}

describe('Money and canonical order snapshots', () => {
  it('rounds tax once and includes only taxable fees in its base', () => {
    expect(
      totals(
        [{ quantity: 3, unitPrice: 199 }],
        [
          { id: 'one', name: 'Taxed', amount: 150, taxable: true },
          { id: 'two', name: 'Untaxed', amount: 200, taxable: false }
        ],
        13
      )
    ).toEqual({ subtotal: 597, fees: 350, tax: 97, total: 1044 });
    expect(totals([{ quantity: 1, unitPrice: 5 }], [], 10).tax).toBe(1);
    expect(taxCents(789123456789, 12.3456)).toBe(
      Number((789123456789n * 123456n + 500000n) / 1000000n)
    );
  });
  it('ignores renderer-supplied prices and recipes and requires a valid size', () => {
    const state = applyCommand(empty(), { type: 'save-order', draft: draft() }, now);
    expect(state.orders[0].lines[0].unitPrice).toBe(199);
    expect(state.orders[0].lines[0].recipe).toEqual([{ inventoryId: 'snickers', quantity: 1 }]);
    const pizza = draft();
    pizza.lines[0].menuItemId = 'margherita';
    expect(() => applyCommand(empty(), { type: 'save-order', draft: pizza }, now)).toThrow(
      'Choose a size'
    );
    pizza.lines[0].variantId = 'large';
    expect(
      applyCommand(empty(), { type: 'save-order', draft: pizza }, now).orders[0].lines[0].unitPrice
    ).toBe(1849);
  });
  it('keeps existing line, fee and tax snapshots while newly added lines use current prices', () => {
    const first = draft();
    first.feeIds = ['delivery'];
    let state = applyCommand(empty(), { type: 'save-order', draft: first }, now);
    state.config.taxRate = 20;
    state.config.fees[0].amount = 900;
    state.menu.find((i) => i.id === 'snickers-bar')!.price = 999;
    const change = edit(state.orders[0], 2);
    change.lines.push({ ...change.lines[0], id: 'new-line', quantity: 1 });
    state = applyCommand(state, { type: 'save-order', draft: change }, now);
    expect(state.orders[0].taxRate).toBe(13);
    expect(state.orders[0].fees[0].amount).toBe(250);
    expect(state.orders[0].lines.map((l) => l.unitPrice)).toEqual([199, 999]);
  });
  it('idempotently creates a stable cart ID and rejects stale edits', () => {
    const command = { type: 'save-order' as const, draft: draft() };
    const state = applyCommand(empty(), command, now);
    expect(applyCommand(state, command, now)).toBe(state);
    expect(() => applyCommand(state, { type: 'save-order', draft: draft(3) }, now)).toThrow(
      'already saved'
    );
    const update = edit(state.orders[0], 2);
    const changed = applyCommand(state, { type: 'save-order', draft: update }, now);
    expect(() => applyCommand(changed, { type: 'save-order', draft: update }, now)).toThrow(
      'changed on another screen'
    );
    expect(changed.orders).toHaveLength(1);
  });
});

describe('Completion and inventory ledger', () => {
  it('deducts only upon completion, applies completed edit deltas and restores cancellation', () => {
    let state = applyCommand(empty(), { type: 'save-order', draft: draft(2) }, now);
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(100);
    const complete = {
      type: 'complete-order' as const,
      id: state.orders[0].id,
      expectedRevision: state.orders[0].revision
    };
    state = applyCommand(state, complete, now);
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(98);
    expect(() => applyCommand(state, complete, now)).toThrow();
    state.config.inventoryEnabled = false; // Completed orders retain their original inventory policy.
    state = applyCommand(state, { type: 'save-order', draft: edit(state.orders[0], 5) }, now);
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(95);
    state = applyCommand(state, { type: 'save-order', draft: edit(state.orders[0], 1) }, now);
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(99);
    state = applyCommand(
      state,
      { type: 'cancel-order', id: state.orders[0].id, expectedRevision: state.orders[0].revision },
      now
    );
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(100);
    expect(state.movements.reduce((n, m) => n + m.quantity, 0)).toBe(0);
  });
  it('auto completes retail orders once and remembers inventory feature state', () => {
    let state = empty();
    state.config.autoCompleteOrders = true;
    state.config.inventoryEnabled = false;
    state = applyCommand(state, { type: 'save-order', draft: draft(2) }, now);
    expect(state.orders[0].status).toBe('completed');
    expect(state.orders[0].inventoryTracked).toBe(false);
    expect(state.movements).toHaveLength(0);
    state.config.inventoryEnabled = true;
    state = applyCommand(state, { type: 'save-order', draft: edit(state.orders[0], 3) }, now);
    expect(state.movements).toHaveLength(0);
    const next = { ...draft(2), id: 'second-cart' };
    state = applyCommand(state, { type: 'save-order', draft: next }, now);
    expect(state.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(98);
    expect(
      applyCommand(state, { type: 'save-order', draft: next }, now).inventory.find(
        (i) => i.id === 'snickers'
      )!.quantity
    ).toBe(98);
  });
  it('uses fractional ingredient quantities without drift and permits low stock', () => {
    let state = empty();
    state.inventory.find((i) => i.id === 'cheese')!.quantity = 0.1;
    state.config.autoCompleteOrders = true;
    const d = draft();
    d.lines[0].menuItemId = 'margherita';
    d.lines[0].variantId = 'medium';
    state = applyCommand(state, { type: 'save-order', draft: d }, now);
    expect(state.inventory.find((i) => i.id === 'cheese')!.quantity).toBe(-0.12);
    state = applyCommand(
      state,
      { type: 'cancel-order', id: state.orders[0].id, expectedRevision: 1 },
      now
    );
    expect(state.inventory.find((i) => i.id === 'cheese')!.quantity).toBe(0.1);
  });
  it('restocks with an auditable movement and rejects bad recipes and numeric input', () => {
    const state = empty();
    const restocked = applyCommand(
      state,
      { type: 'restock', inventoryId: 'snickers', quantity: 12, note: 'Supplier receipt 102' },
      now
    );
    expect(restocked.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(112);
    expect(restocked.movements.at(-1)?.reason).toBe('restock');
    expect(() =>
      applyCommand(state, { type: 'restock', inventoryId: 'snickers', quantity: -2, note: '' })
    ).toThrow();
    const item = structuredClone(state.menu[0]);
    item.recipe = [{ inventoryId: 'missing', quantity: 1 }];
    expect(() =>
      applyCommand(state, { type: 'save-menu', item, expectedRevision: state.revision })
    ).toThrow('unknown inventory');
    expect(() =>
      applyCommand(state, {
        type: 'save-config',
        expectedRevision: state.revision,
        config: { ...state.config, taxRate: 'thirteen' as any }
      })
    ).toThrow();
    expect(() =>
      applyCommand(state, {
        type: 'save-config',
        expectedRevision: state.revision,
        config: { ...state.config, currency: 'JPY' }
      })
    ).toThrow('two-decimal');
  });
});

describe('Audit and persisted integrity', () => {
  it('reports completed sales only; cancelled sales removed; item revenue excludes fees and tax', () => {
    let state = empty();
    state.config.autoCompleteOrders = true;
    state = applyCommand(
      state,
      { type: 'save-order', draft: { ...draft(2), feeIds: ['delivery'] } },
      now
    );
    state.config.autoCompleteOrders = false;
    state = applyCommand(
      state,
      { type: 'save-order', draft: { ...draft(), id: 'pending-cart' } },
      now
    );
    const report = audit(state, '2026-09-30', '2026-09-30');
    expect(report.orderCount).toBe(1);
    expect(report.subtotal).toBe(398);
    expect(report.fees).toBe(250);
    expect(report.gross).toBe(732);
    expect(report.items[0].revenue).toBe(398);
    expect(report.inventory.find((i) => i.id === 'snickers')!.quantity).toBe(2);
    state = applyCommand(state, { type: 'cancel-order', id: 'cart-123', expectedRevision: 1 }, now);
    expect(audit(state, '2026-09-30', '2026-09-30').orderCount).toBe(0);
  });
  it('rejects impossible dates, inconsistent totals and duplicate stored IDs', () => {
    const state = applyCommand(empty(), { type: 'save-order', draft: draft() }, now);
    expect(() => audit(state, '2026-02-30', '2026-03-01')).toThrow();
    expect(() => audit(state, '2026-09-30', '2026-09-01')).toThrow();
    state.orders[0].totals.total++;
    expect(() => validateState(state)).toThrow('inconsistent');
    state.orders[0].totals.total--;
    state.menu.push(state.menu[0]);
    expect(() => validateState(state)).toThrow('duplicate IDs');
  });
  it('prevents relabelling historical sales with another currency', () => {
    const state = applyCommand(empty(), { type: 'save-order', draft: draft() }, now);
    expect(() =>
      applyCommand(state, {
        type: 'save-config',
        config: { ...state.config, currency: 'USD' },
        expectedRevision: state.revision
      })
    ).toThrow('historical orders');
  });
  it('rejects corrupt historical ingredient and movement references', () => {
    const state = createDemo(new Date(now));
    state.orders[0].lines[0].recipe[0].inventoryId = 'unknown-stock';
    expect(() => validateState(state)).toThrow('unknown inventory');
    state.orders[0].lines[0].recipe[0].inventoryId = 'dough';
    const movement = state.movements.find((m) => m.orderId)!;
    movement.orderId = 'unknown-order';
    expect(() => validateState(state)).toThrow('unknown order');
  });
  it('always includes completed sales today, even just after midnight', () => {
    const date = new Date(2026, 8, 30, 0, 0, 1);
    const state = createDemo(date);
    expect(audit(state, '2026-09-30', '2026-09-30').orderCount).toBeGreaterThan(0);
    expect(
      state.orders.filter((o) => o.completedAt).every((o) => +new Date(o.completedAt!) <= +date)
    ).toBe(true);
  });
  it('provides useful demonstration stock, sizes, simple retail, open and completed orders', () => {
    const state = createDemo(new Date(now));
    validateState(state);
    expect(state.menu.some((i) => i.variants.length > 0)).toBe(true);
    expect(state.menu.some((i) => i.name === 'Snickers bar')).toBe(true);
    expect(new Set(state.orders.map((o) => o.status)).size).toBe(2);
    expect(state.movements.some((m) => m.reason === 'restock')).toBe(true);
  });
});
