import { describe, it, expect } from 'vitest';
import { escapeHtml, receiptHtml } from '../src/main/receipt';
import type { Order, BusinessConfig } from '../src/shared/types';
describe('receipts', () => {
  it('escapes every HTML-sensitive character', () => {
    expect(escapeHtml(`<script a="'">&`)).toBe('&lt;script a=&quot;&#39;&quot;&gt;&amp;');
  });
  it('prints captured amounts and escapes customer and product content', () => {
    const order: Order = {
      id: 'x',
      number: 1001,
      revision: 1,
      status: 'completed',
      fulfillment: 'takeout',
      customerName: '<img src=x>',
      phone: '',
      address: '',
      notes: '<script>bad()</script>',
      lines: [
        {
          id: 'l',
          menuItemId: 'm',
          name: '<Pizza>',
          quantity: 2,
          unitPrice: 1250,
          recipe: [],
          notes: ''
        }
      ],
      fees: [{ id: 'f', name: 'Delivery', amount: 200, taxable: true }],
      taxRate: 13,
      totals: { subtotal: 2500, fees: 200, tax: 351, total: 3051 },
      createdAt: '2026-09-30T12:00:00Z',
      updatedAt: '2026-09-30T12:00:00Z'
    };
    const config: BusinessConfig = {
      businessName: 'Test shop',
      currency: 'CAD',
      taxRate: 13,
      autoCompleteOrders: false,
      inventoryEnabled: true,
      fees: [],
      receiptFooter: 'Thank you'
    };
    const result = receiptHtml(order, config);
    expect(result).toContain('$30.51');
    expect(result).toContain('&lt;Pizza&gt;');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
    expect(result).toContain('Payment is handled separately');
  });
});
