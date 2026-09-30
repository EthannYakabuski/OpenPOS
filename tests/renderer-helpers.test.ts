import { describe, expect, it } from 'vitest';
import type { BusinessConfig, Order, OrderDraft } from '../src/shared/types';
import {
  cents,
  draftTotals,
  emptyDraft,
  localDate,
  orderDraft,
  priceInput
} from '../src/renderer/helpers';

const config: BusinessConfig = {
  businessName: 'Test',
  currency: 'CAD',
  taxRate: 13,
  autoCompleteOrders: false,
  inventoryEnabled: true,
  receiptFooter: '',
  fees: [
    { id: 'delivery', name: 'Delivery', amount: 200, taxable: true },
    { id: 'optional', name: 'Non-taxable fee', amount: 150, taxable: false }
  ]
};
const draft = (): OrderDraft => ({
  ...emptyDraft(),
  lines: [
    {
      id: 'line',
      menuItemId: 'pizza',
      name: 'Pizza',
      quantity: 2,
      unitPrice: 1499,
      recipe: [{ inventoryId: 'dough', quantity: 1 }],
      notes: ''
    }
  ]
});

describe('renderer order calculations', () => {
  it('adds fees once and taxes only taxable fees using rounded integer cents', () => {
    const order = draft();
    order.feeIds = ['delivery', 'delivery', 'optional'];
    expect(draftTotals(order, config)).toEqual({
      subtotal: 2998,
      fees: 350,
      tax: 416,
      total: 3764
    });
  });
  it('keeps empty carts at zero and ignores unknown fee ids', () => {
    const order = emptyDraft();
    order.feeIds = ['unknown'];
    expect(draftTotals(order, config)).toEqual({ subtotal: 0, fees: 0, tax: 0, total: 0 });
  });
  it('converts decimal input without floating point cent errors', () => {
    expect(cents('19.99')).toBe(1999);
    expect(cents('0.29')).toBe(29);
    expect(priceInput(5)).toBe('0.05');
    expect(priceInput(0)).toBe('0.00');
  });
  it('gives each new ticket its own stable id with no editing revision', () => {
    const first = emptyDraft(),
      second = emptyDraft();
    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);
    expect(first.expectedRevision).toBeUndefined();
  });
  it('copies saved order snapshots so editing does not mutate loaded records', () => {
    const source: Order = {
      ...draft(),
      id: 'saved',
      number: 1,
      status: 'completed',
      fees: [config.fees[0]],
      taxRate: 13,
      totals: { subtotal: 2998, fees: 200, tax: 416, total: 3614 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revision: 4
    };
    const edited = orderDraft(source);
    edited.lines[0].quantity = 3;
    edited.lines[0].recipe[0].quantity = 9;
    expect(source.lines[0].quantity).toBe(2);
    expect(source.lines[0].recipe[0].quantity).toBe(1);
    expect(edited.expectedRevision).toBe(4);
    expect(edited.feeIds).toEqual(['delivery']);
  });
  it('formats local date components rather than UTC day boundaries', () => {
    expect(localDate(new Date(2026, 0, 2, 0, 15))).toBe('2026-01-02');
  });
});
