import React, { useEffect, useState } from 'react';
import {
  mdiCheck,
  mdiPencilOutline,
  mdiReceiptTextOutline,
  mdiClockOutline,
  mdiTruckDeliveryOutline,
  mdiShoppingOutline,
  mdiSilverwareForkKnife,
  mdiClose
} from '@mdi/js';
import type { Order, Snapshot } from '../shared/types';
import { localDate, money } from './helpers';
import { Empty, I } from './ui';

const ORDER_PAGE_SIZE = 50;
type OrderColumn = 'progress' | 'completed' | 'cancelled';

export function Orders({
  snapshot,
  busy,
  onEdit,
  onReceipt,
  onComplete,
  onCancel
}: {
  snapshot: Snapshot;
  busy: boolean;
  onEdit: (order: Order) => void;
  onReceipt: (order: Order) => void;
  onComplete: (order: Order) => void;
  onCancel: (order: Order) => void;
}) {
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [cancelled, setCancelled] = useState(false);
  const [visible, setVisible] = useState<Record<OrderColumn, number>>({
    progress: ORDER_PAGE_SIZE,
    completed: ORDER_PAGE_SIZE,
    cancelled: ORDER_PAGE_SIZE
  });
  useEffect(() => {
    setVisible({
      progress: ORDER_PAGE_SIZE,
      completed: ORDER_PAGE_SIZE,
      cancelled: ORDER_PAGE_SIZE
    });
  }, [search, date, cancelled]);
  const orders = snapshot.state.orders
    .filter(
      (order) =>
        (!date || localDate(new Date(order.createdAt)) === date) &&
        `${order.number} ${order.customerName} ${order.phone} ${order.lines.map((line) => line.name).join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const progress = orders.filter((order) => order.status === 'in-progress');
  const completed = orders.filter((order) => order.status === 'completed');
  const voided = orders.filter((order) => order.status === 'cancelled');
  const card = (order: Order) => (
    <article className={`order-card ${order.status}`} key={order.id}>
      <header>
        <div className="order-number">
          <strong>#{String(order.number).padStart(3, '0')}</strong>
          <span className={`status-label ${order.status}`}>
            {order.status === 'in-progress'
              ? 'In progress'
              : order.status === 'completed'
                ? 'Completed'
                : 'Cancelled'}
          </span>
        </div>
        <span className="order-time" title={new Date(order.createdAt).toLocaleString()}>
          {localDate(new Date(order.createdAt)) === localDate()
            ? new Date(order.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })
            : new Date(order.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </span>
      </header>
      <div className="order-customer">
        <strong>{order.customerName || 'Walk-in customer'}</strong>
        <span>
          <I
            path={
              order.fulfillment === 'delivery'
                ? mdiTruckDeliveryOutline
                : order.fulfillment === 'dine-in'
                  ? mdiSilverwareForkKnife
                  : mdiShoppingOutline
            }
            size={0.7}
          />
          {order.fulfillment}
        </span>
      </div>
      {order.phone && <div className="order-contact">{order.phone}</div>}
      {order.fulfillment === 'delivery' && order.address && (
        <div className="order-contact">{order.address}</div>
      )}
      <div className="order-items">
        {order.lines.map((line) => (
          <div key={line.id}>
            <span className="order-item-quantity">{line.quantity}×</span>
            <span>
              {line.name}
              {line.variantName && <small> · {line.variantName}</small>}
              {line.notes && <em>{line.notes}</em>}
            </span>
          </div>
        ))}
      </div>
      {order.notes && <p className="order-note">{order.notes}</p>}
      <div className="order-card-total">
        <span>{order.lines.reduce((sum, line) => sum + line.quantity, 0)} items</span>
        <strong>{money(order.totals.total, snapshot.state.config.currency)}</strong>
      </div>
      <footer>
        <button
          className="secondary small"
          disabled={busy || order.status === 'cancelled'}
          onClick={() => onEdit(order)}
          title="Edit items, customer details or fees"
        >
          <I path={mdiPencilOutline} size={0.75} /> Edit
        </button>
        <button
          className="icon-button"
          disabled={busy}
          title="View and print receipt"
          aria-label={`Receipt for order ${order.number}`}
          onClick={() => onReceipt(order)}
        >
          <I path={mdiReceiptTextOutline} size={0.85} />
        </button>
        {order.status !== 'cancelled' && (
          <button
            className="icon-button danger"
            disabled={busy}
            title="Cancel order and reverse inventory consumption"
            aria-label={`Cancel order ${order.number}`}
            onClick={() => onCancel(order)}
          >
            <I path={mdiClose} size={0.8} />
          </button>
        )}
        {order.status === 'in-progress' && (
          <button
            className="primary small complete-button"
            disabled={busy}
            onClick={() => onComplete(order)}
            title="Mark completed and deduct inventory"
          >
            <I path={mdiCheck} size={0.8} /> Completed
          </button>
        )}
      </footer>
    </article>
  );
  const orderList = (items: Order[], column: OrderColumn, label: string) => (
    <>
      {items.slice(0, visible[column]).map(card)}
      {items.length > ORDER_PAGE_SIZE && (
        <div className="order-pagination">
          <p className="muted" role="status">
            Showing {Math.min(visible[column], items.length)} of {items.length} {label}
          </p>
          {visible[column] < items.length && (
            <button
              className="secondary"
              onClick={() =>
                setVisible((previous) => ({
                  ...previous,
                  [column]: previous[column] + ORDER_PAGE_SIZE
                }))
              }
              aria-label={`Load more ${label}`}
            >
              Load {Math.min(ORDER_PAGE_SIZE, items.length - visible[column])} more
            </button>
          )}
        </div>
      )}
    </>
  );
  return (
    <section className="orders-view">
      <div className="page-heading">
        <div>
          <div className="eyebrow">ORDER WORKSPACE</div>
          <h1>Orders</h1>
          <p>Manage active tickets and review completed orders.</p>
        </div>
        <span className="live-indicator">
          <span className="status-dot online" /> Live updates
        </span>
      </div>
      <div className="order-filters">
        <input
          className="search-input"
          aria-label="Search orders"
          placeholder="Search order, customer or item…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <label className="inline-field">
          <span>Order date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        {date && (
          <button className="text-button" onClick={() => setDate('')}>
            All dates
          </button>
        )}
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={cancelled}
            onChange={(event) => setCancelled(event.target.checked)}
          />{' '}
          Show cancelled
        </label>
      </div>
      <div className="order-columns">
        <section className="order-column">
          <div className="column-heading">
            <h2>
              <span className="column-dot progress" />
              In progress <span className="count-pill">{progress.length}</span>
            </h2>
            <I path={mdiClockOutline} size={0.85} />
          </div>
          {progress.length ? (
            orderList(progress, 'progress', 'in-progress orders')
          ) : (
            <Empty
              path={mdiCheck}
              title="All caught up"
              text="New orders will appear here, ready for the team."
            />
          )}
        </section>
        <section className="order-column">
          <div className="column-heading">
            <h2>
              <span className="column-dot done" />
              Completed <span className="count-pill">{completed.length}</span>
            </h2>
            <I path={mdiCheck} size={0.85} />
          </div>
          {completed.length ? (
            orderList(completed, 'completed', 'completed orders')
          ) : (
            <Empty
              path={mdiReceiptTextOutline}
              title="Nothing completed yet"
              text="Complete a ticket to move it to this list."
            />
          )}
        </section>
        {cancelled && (
          <section className="order-column">
            <div className="column-heading">
              <h2>
                Cancelled <span className="count-pill">{voided.length}</span>
              </h2>
            </div>
            {voided.length ? (
              orderList(voided, 'cancelled', 'cancelled orders')
            ) : (
              <p className="muted">No cancelled orders.</p>
            )}
          </section>
        )}
      </div>
    </section>
  );
}
