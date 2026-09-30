import React, { useState } from 'react';
import {
  mdiMinus,
  mdiPlus,
  mdiTrashCanOutline,
  mdiReceiptTextOutline,
  mdiShoppingOutline,
  mdiTruckDeliveryOutline,
  mdiSilverwareForkKnife,
  mdiArrowRight,
  mdiNoteEditOutline,
  mdiClose
} from '@mdi/js';
import type { BusinessConfig, OrderDraft, OrderLine } from '../shared/types';
import { draftTotals, money } from './helpers';
import { Empty, I } from './ui';

export function Cart({
  draft,
  config,
  busy,
  editingNumber,
  onChange,
  onSubmit,
  onClear
}: {
  draft: OrderDraft;
  config: BusinessConfig;
  busy: boolean;
  editingNumber?: number;
  onChange: (draft: OrderDraft) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const [noteLine, setNoteLine] = useState<string | null>(null);
  const totals = draftTotals(draft, config);
  const fmt = (value: number) => money(value, config.currency);
  const patch = (value: Partial<OrderDraft>) => onChange({ ...draft, ...value });
  const patchLine = (id: string, value: Partial<OrderLine>) =>
    patch({ lines: draft.lines.map((line) => (line.id === id ? { ...line, ...value } : line)) });
  const qty = draft.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <aside className="cart-panel">
      <div className="cart-heading">
        <div>
          <h2>
            {draft.expectedRevision !== undefined
              ? `Edit order #${editingNumber ?? ''}`
              : 'Current order'}
          </h2>
          <span className="muted">
            {qty ? `${qty} ${qty === 1 ? 'item' : 'items'} on the ticket` : 'Ready when you are'}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label={
            draft.expectedRevision !== undefined ? 'Cancel order editing' : 'Clear current order'
          }
          title={draft.expectedRevision !== undefined ? 'Cancel editing' : 'Clear current order'}
          disabled={busy || (draft.expectedRevision === undefined && !draft.lines.length)}
          onClick={onClear}
        >
          <I
            path={draft.expectedRevision !== undefined ? mdiClose : mdiTrashCanOutline}
            size={0.85}
          />
        </button>
      </div>
      <div className="fulfillment-options" aria-label="Order type">
        {(
          [
            { value: 'takeout', label: 'Takeout', icon: mdiShoppingOutline },
            { value: 'delivery', label: 'Delivery', icon: mdiTruckDeliveryOutline },
            { value: 'dine-in', label: 'Dine-in', icon: mdiSilverwareForkKnife }
          ] as const
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            className={draft.fulfillment === option.value ? 'active' : ''}
            aria-pressed={draft.fulfillment === option.value}
            onClick={() => patch({ fulfillment: option.value })}
            disabled={busy}
          >
            <I path={option.icon} size={0.8} />
            {option.label}
          </button>
        ))}
      </div>
      <div className="cart-scroll">
        <div className="cart-lines">
          {!draft.lines.length ? (
            <Empty
              path={mdiReceiptTextOutline}
              title="Let’s start an order"
              text="Tap a menu item to add it here."
            />
          ) : (
            draft.lines.map((line) => (
              <div className="cart-line" key={line.id}>
                <div className="cart-line-top">
                  <div>
                    <strong>{line.name}</strong>
                    {line.variantName && <small>{line.variantName}</small>}
                  </div>
                  <strong>{fmt(line.unitPrice * line.quantity)}</strong>
                </div>
                <div className="cart-line-bottom">
                  <div className="quantity-stepper">
                    <button
                      aria-label={`Remove one ${line.name}`}
                      disabled={busy}
                      title="Decrease quantity"
                      onClick={() =>
                        line.quantity <= 1
                          ? patch({ lines: draft.lines.filter((row) => row.id !== line.id) })
                          : patchLine(line.id, { quantity: line.quantity - 1 })
                      }
                    >
                      <I path={mdiMinus} size={0.65} />
                    </button>
                    <span aria-label="Quantity">{line.quantity}</span>
                    <button
                      aria-label={`Add one ${line.name}`}
                      disabled={busy || line.quantity >= 999}
                      title="Increase quantity"
                      onClick={() => patchLine(line.id, { quantity: line.quantity + 1 })}
                    >
                      <I path={mdiPlus} size={0.65} />
                    </button>
                  </div>
                  <small className="muted">{fmt(line.unitPrice)} each</small>
                  <button
                    className={`icon-button line-note ${line.notes ? 'has-note' : ''}`}
                    aria-label={`Add note to ${line.name}`}
                    title={line.notes || 'Add preparation note'}
                    disabled={busy}
                    onClick={() => setNoteLine(noteLine === line.id ? null : line.id)}
                  >
                    <I path={mdiNoteEditOutline} size={0.8} />
                  </button>
                </div>
                {noteLine === line.id ? (
                  <input
                    className="line-note-input"
                    autoFocus
                    aria-label={`${line.name} preparation note`}
                    value={line.notes}
                    maxLength={500}
                    placeholder="e.g. No onions, well done"
                    onChange={(event) => patchLine(line.id, { notes: event.target.value })}
                  />
                ) : (
                  line.notes && <p className="line-note-preview">{line.notes}</p>
                )}
              </div>
            ))
          )}
        </div>
        <details
          className="customer-details"
          open={draft.fulfillment === 'delivery' ? true : undefined}
        >
          <summary>
            Customer & order notes {draft.customerName && <span>· {draft.customerName}</span>}
          </summary>
          <div className="customer-fields">
            <label>
              <span>Customer name</span>
              <input
                value={draft.customerName}
                maxLength={100}
                placeholder="Name for this order"
                disabled={busy}
                onChange={(event) => patch({ customerName: event.target.value })}
              />
            </label>
            <label>
              <span>Phone</span>
              <input
                type="tel"
                value={draft.phone}
                maxLength={40}
                placeholder="Phone number"
                disabled={busy}
                onChange={(event) => patch({ phone: event.target.value })}
              />
            </label>
            {draft.fulfillment === 'delivery' && (
              <label>
                <span>Delivery address</span>
                <textarea
                  rows={2}
                  value={draft.address}
                  maxLength={500}
                  placeholder="Street, unit and delivery instructions"
                  disabled={busy}
                  onChange={(event) => patch({ address: event.target.value })}
                />
              </label>
            )}
            <label>
              <span>Order notes</span>
              <textarea
                rows={2}
                value={draft.notes}
                maxLength={1000}
                placeholder="Anything the team should know"
                disabled={busy}
                onChange={(event) => patch({ notes: event.target.value })}
              />
            </label>
          </div>
        </details>
        {config.fees.length > 0 && (
          <section className="cart-fees">
            <h3>
              Fees <span>optional</span>
            </h3>
            <div className="fee-chips">
              {config.fees.map((fee) => (
                <button
                  disabled={busy}
                  key={fee.id}
                  className={draft.feeIds.includes(fee.id) ? 'selected' : ''}
                  aria-pressed={draft.feeIds.includes(fee.id)}
                  title={`${fee.name}: ${fmt(fee.amount)}${fee.taxable ? ', taxable' : ', not taxable'}`}
                  onClick={() =>
                    patch({
                      feeIds: draft.feeIds.includes(fee.id)
                        ? draft.feeIds.filter((id) => id !== fee.id)
                        : [...draft.feeIds, fee.id]
                    })
                  }
                >
                  {fee.name}
                  <span>+{fmt(fee.amount)}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer className="cart-footer">
        <div className="totals-row">
          <span>Subtotal</span>
          <span>{fmt(totals.subtotal)}</span>
        </div>
        {totals.fees > 0 && (
          <div className="totals-row">
            <span>Fees</span>
            <span>{fmt(totals.fees)}</span>
          </div>
        )}
        <div className="totals-row">
          <span>Tax ({config.taxRate}%)</span>
          <span>{fmt(totals.tax)}</span>
        </div>
        <div className="totals-row total">
          <strong>Total</strong>
          <strong>{fmt(totals.total)}</strong>
        </div>
        <button
          className="primary order-button"
          disabled={busy || !draft.lines.length}
          onClick={onSubmit}
        >
          <I path={mdiReceiptTextOutline} size={0.95} />
          <span>
            {busy
              ? 'Saving order…'
              : draft.expectedRevision !== undefined
                ? 'Save changes'
                : 'Order'}
          </span>
          <I path={mdiArrowRight} size={0.95} />
        </button>
        <p>
          {draft.expectedRevision !== undefined
            ? 'Changes are shared with connected devices.'
            : config.autoCompleteOrders
              ? 'Orders complete automatically.'
              : 'Send to the team. Keep things moving.'}
        </p>
      </footer>
    </aside>
  );
}
