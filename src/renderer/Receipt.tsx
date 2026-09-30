import React, { useState } from 'react';
import { mdiPrinterOutline, mdiCheckCircleOutline } from '@mdi/js';
import type { Order, Snapshot } from '../shared/types';
import { money } from './helpers';
import { ErrorText, I, Modal, errorMessage } from './ui';

export function Receipt({
  order,
  snapshot,
  justSaved = false,
  onClose
}: {
  order: Order;
  snapshot: Snapshot;
  justSaved?: boolean;
  onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fmt = (value: number) => money(value, snapshot.state.config.currency);
  const print = async () => {
    setBusy(true);
    setError('');
    try {
      await window.openpos.printReceipt(order.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={justSaved ? 'Order saved' : `Receipt #${order.number}`}
      subtitle={
        justSaved
          ? 'Your ticket is ready. The team is up to date.'
          : new Date(order.createdAt).toLocaleString()
      }
      onClose={() => !busy && onClose()}
    >
      <div className="modal-body receipt-body">
        <ErrorText error={error} />
        {justSaved && (
          <div className="receipt-success">
            <I path={mdiCheckCircleOutline} size={1.6} />
          </div>
        )}
        <div className="receipt-paper">
          <header>
            <h2>{snapshot.state.config.businessName}</h2>
            <p>ORDER #{String(order.number).padStart(3, '0')}</p>
            <small>{new Date(order.createdAt).toLocaleString()}</small>
            <p className="receipt-status">
              {order.fulfillment} · {order.status.replace('-', ' ')}
            </p>
          </header>
          {(order.customerName || order.phone || order.address) && (
            <div className="receipt-customer">
              <strong>{order.customerName}</strong>
              {order.phone && <div>{order.phone}</div>}
              {order.address && <div>{order.address}</div>}
            </div>
          )}
          <div className="receipt-lines">
            {order.lines.map((line) => (
              <div className="receipt-line" key={line.id}>
                <div>
                  <strong>
                    {line.quantity}× {line.name}
                  </strong>
                  {line.variantName && <small>{line.variantName}</small>}
                  {line.notes && <small>{line.notes}</small>}
                </div>
                <span>{fmt(line.quantity * line.unitPrice)}</span>
              </div>
            ))}
          </div>
          <div className="totals-row">
            <span>Subtotal</span>
            <span>{fmt(order.totals.subtotal)}</span>
          </div>
          {order.fees.map((fee) => (
            <div className="totals-row" key={fee.id}>
              <span>{fee.name}</span>
              <span>{fmt(fee.amount)}</span>
            </div>
          ))}
          <div className="totals-row">
            <span>Tax ({order.taxRate}%)</span>
            <span>{fmt(order.totals.tax)}</span>
          </div>
          <div className="totals-row total">
            <strong>Total</strong>
            <strong>{fmt(order.totals.total)}</strong>
          </div>
          {order.notes && <p className="receipt-notes">{order.notes}</p>}
          <footer>{snapshot.state.config.receiptFooter || 'Thank you for your order!'}</footer>
        </div>
      </div>
      <footer className="modal-footer">
        <button className="secondary" disabled={busy} onClick={print}>
          <I path={mdiPrinterOutline} size={0.9} />
          {busy ? 'Printing…' : 'Print receipt'}
        </button>
        <button className="primary" disabled={busy} onClick={onClose}>
          {justSaved ? 'Next order' : 'Done'}
        </button>
      </footer>
    </Modal>
  );
}
