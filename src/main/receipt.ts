import type { BusinessConfig, Order } from '../shared/types';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!
  );
}

export function receiptHtml(order: Order, config: BusinessConfig): string {
  const money = (cents: number) =>
    escapeHtml(
      new Intl.NumberFormat('en-CA', { style: 'currency', currency: config.currency }).format(
        cents / 100
      )
    );
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>OpenPOS · Receipt ${e(order.number)}</title><style>
  *{box-sizing:border-box}body{font:14px 'Segoe UI',sans-serif;color:#152f29;max-width:380px;margin:32px auto;padding:20px}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:24px 0 8px}p{margin:6px 0;white-space:pre-wrap}small{color:#56655e}table{border-collapse:collapse;width:100%;margin:20px 0}td{padding:10px 0;border-bottom:1px dashed #bcc6bf;vertical-align:top}td:last-child{text-align:right;white-space:nowrap}.pair{display:flex;justify-content:space-between;gap:12px;padding:5px 0}.total{border-top:2px solid #152f29;margin-top:10px;padding-top:14px;font-size:22px;font-weight:bold}.footer{border-top:1px dashed #a0aaa4;text-align:center;margin-top:24px;padding-top:16px}@media print{body{margin:0;max-width:none;color:#000;padding:0}small{color:#333}@page{margin:10mm}}
  </style></head><body><h1>${e(config.businessName)}</h1><p>Order #${e(order.number)} · ${e(order.fulfillment)}</p><p><small>${e(new Date(order.createdAt).toLocaleString())} · ${e(order.status)}</small></p>${order.customerName ? `<h2>${e(order.customerName)}</h2>` : ''}${order.phone ? `<p>${e(order.phone)}</p>` : ''}${order.address ? `<p>${e(order.address)}</p>` : ''}<table aria-label="Order items">${order.lines.map((line) => `<tr><td>${e(line.quantity)} × ${e(line.name)}${line.variantName ? ` · ${e(line.variantName)}` : ''}${line.notes ? `<br><small>${e(line.notes)}</small>` : ''}</td><td>${money(line.quantity * line.unitPrice)}</td></tr>`).join('')}</table><div class="pair"><span>Subtotal</span><span>${money(order.totals.subtotal)}</span></div>${order.fees.map((fee) => `<div class="pair"><span>${e(fee.name)}</span><span>${money(fee.amount)}</span></div>`).join('')}<div class="pair"><span>Tax (${e(order.taxRate)}%)</span><span>${money(order.totals.tax)}</span></div><div class="pair total"><span>Total</span><span>${money(order.totals.total)}</span></div>${order.notes ? `<h2>Order notes</h2><p>${e(order.notes)}</p>` : ''}<div class="footer"><p>${e(config.receiptFooter)}</p><small>Order receipt · Payment is handled separately.</small></div></body></html>`;
}
