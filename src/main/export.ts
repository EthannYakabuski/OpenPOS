import type { AuditReport } from '../shared/types';

/** UTF-8 BOM for Excel; neutralize formula-like business names in exported cells. */
export function auditCSV(report: AuditReport): string {
  const safe = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [
    ['OpenPOS sales report'],
    ['Metric', 'Value'],
    ['Completed orders', report.orderCount],
    ['Item sales', (report.subtotal / 100).toFixed(2)],
    ['Fees', (report.fees / 100).toFixed(2)],
    ['Tax', (report.tax / 100).toFixed(2)],
    ['Gross including tax', (report.gross / 100).toFixed(2)],
    [],
    ['Item', 'Quantity', 'Item revenue'],
    ...report.items.map((item) => [item.name, item.quantity, (item.revenue / 100).toFixed(2)]),
    [],
    ['Inventory item', 'Unit', 'Consumed quantity'],
    ...report.inventory.map((item) => [item.name, item.unit, item.quantity])
  ];
  return '\uFEFF' + rows.map((row) => row.map(safe).join(',')).join('\r\n');
}
