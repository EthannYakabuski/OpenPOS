import { describe, expect, it } from 'vitest';
import { auditCSV } from '../src/main/export';
import type { AuditReport } from '../src/shared/types';
describe('sales export', () => {
  it('escapes quotes, formula-like item names and writes decimal money for Excel', () => {
    const report: AuditReport = {
      orderCount: 1,
      subtotal: 1250,
      fees: 200,
      tax: 189,
      gross: 1639,
      averageOrder: 1639,
      items: [{ id: 'a', name: '=DANGEROUS("text")', quantity: 1, revenue: 1250 }],
      inventory: [],
      daily: []
    };
    const csv = auditCSV(report);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"\'=DANGEROUS(""text"")"');
    expect(csv).toContain('"Gross including tax","16.39"');
    expect(csv).toContain('\r\n');
  });
});
