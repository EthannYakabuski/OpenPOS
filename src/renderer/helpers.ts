import type { BusinessConfig, Order, OrderDraft, OrderTotals } from '../shared/types';
import { taxCents } from '../shared/money';

export const uid = () => crypto.randomUUID();
export const cents = (value: string): number => Math.round(Number(value) * 100);
export const priceInput = (value: number): string => (value / 100).toFixed(2);
export function money(value: number, currency = 'CAD'): string {
  try {
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency }).format(value / 100);
  } catch {
    return `$${(value / 100).toFixed(2)}`;
  }
}
export const localDate = (date = new Date()): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function draftTotals(draft: OrderDraft, config: BusinessConfig): OrderTotals {
  const subtotal = draft.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const fees = config.fees.filter((fee) => draft.feeIds.includes(fee.id));
  const feesTotal = fees.reduce((sum, fee) => sum + fee.amount, 0);
  const taxable =
    subtotal + fees.filter((fee) => fee.taxable).reduce((sum, fee) => sum + fee.amount, 0);
  const tax = taxCents(taxable, config.taxRate);
  return { subtotal, fees: feesTotal, tax, total: subtotal + feesTotal + tax };
}
export function emptyDraft(): OrderDraft {
  return {
    id: uid(),
    lines: [],
    feeIds: [],
    fulfillment: 'takeout',
    customerName: '',
    phone: '',
    address: '',
    notes: ''
  };
}
export function orderDraft(order: Order): OrderDraft {
  return {
    id: order.id,
    expectedRevision: order.revision,
    lines: structuredClone(order.lines),
    feeIds: order.fees.map((fee) => fee.id),
    fulfillment: order.fulfillment,
    customerName: order.customerName,
    phone: order.phone,
    address: order.address,
    notes: order.notes
  };
}
