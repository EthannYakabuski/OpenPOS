import React, { useEffect, useState } from 'react';
import {
  mdiViewGridOutline,
  mdiReceiptTextOutline,
  mdiChartBoxOutline,
  mdiPlus,
  mdiPackageVariantClosed,
  mdiCogOutline,
  mdiHelpCircleOutline,
  mdiMagnify,
  mdiPencilOutline,
  mdiArrowRight,
  mdiCheck,
  mdiWifi,
  mdiWifiOff,
  mdiShieldAccountOutline,
  mdiClose,
  mdiCoffee
} from '@mdi/js';
import type { Command, MenuItem, Order, OrderDraft, Snapshot, Variant } from '../shared/types';
import { emptyDraft, money, orderDraft, uid } from './helpers';
import { Empty, ErrorText, I, Logo, Modal, errorMessage, icons } from './ui';
import { Cart } from './Cart';
import { MenuEditor } from './MenuEditor';
import { Inventory } from './Inventory';
import { Settings } from './Settings';
import { Orders } from './Orders';
import { Receipt } from './Receipt';
import { Audit } from './Audit';

type Dialog =
  | { kind: 'menu'; item?: MenuItem }
  | { kind: 'inventory' }
  | { kind: 'settings'; tab?: 'business' | 'device' | 'security' }
  | { kind: 'variant'; item: MenuItem }
  | { kind: 'receipt'; order: Order; justSaved?: boolean }
  | {
      kind: 'confirm';
      title: string;
      text: string;
      label: string;
      danger?: boolean;
      action: () => void | Promise<void>;
    }
  | null;

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<'menu' | 'orders' | 'audit'>('menu');
  const [draft, setDraft] = useState<OrderDraft>(emptyDraft);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All items');
  const [showHidden, setShowHidden] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(new Date());
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const start = async () => {
      try {
        if (!window.openpos)
          throw new Error(
            'The OpenPOS desktop connection is unavailable. Please open the installed application.'
          );
        const initial = await window.openpos.getSnapshot();
        if (!active) return;
        setSnapshot(initial);
        setTab(initial.device.defaultTab);
        setError('');
        unsubscribe = window.openpos.onChange((next) => {
          if (active) setSnapshot(next);
        });
      } catch (caught) {
        if (active) setError(errorMessage(caught));
      }
    };
    void start();
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [loadAttempt]);
  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (snapshot && !snapshot.session.isAdmin && tab === 'audit') setTab('menu');
  }, [snapshot?.session.isAdmin, tab]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  const run = async (command: Command): Promise<Snapshot | undefined> => {
    setError('');
    setBusy(true);
    try {
      const next = await window.openpos.execute(command);
      setSnapshot(next);
      return next;
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  if (!snapshot)
    return (
      <main className="startup">
        <Logo />
        <h1>OpenPOS</h1>
        <p>{error ? 'We couldn’t open your workspace.' : 'Preparing your workspace…'}</p>
        <ErrorText error={error} />
        {error ? (
          <button className="primary" onClick={() => setLoadAttempt((value) => value + 1)}>
            Try again
          </button>
        ) : (
          <span className="spinner" aria-label="Loading" />
        )}
      </main>
    );
  const { state, device, session, sync } = snapshot;
  const fmt = (value: number) => money(value, state.config.currency);
  const categories = [
    'All items',
    ...new Set(state.menu.filter((item) => item.active || showHidden).map((item) => item.category))
  ];
  const menu = state.menu.filter(
    (item) =>
      (item.active || showHidden) &&
      (category === 'All items' || item.category === category) &&
      `${item.name} ${item.description} ${item.category}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const progressCount = state.orders.filter((order) => order.status === 'in-progress').length;
  const editingOrder =
    draft.expectedRevision !== undefined
      ? state.orders.find((order) => order.id === draft.id)
      : undefined;
  const cartConfig = editingOrder
    ? {
        ...state.config,
        taxRate: editingOrder.taxRate,
        fees: [
          ...state.config.fees.map(
            (fee) => editingOrder.fees.find((saved) => saved.id === fee.id) ?? fee
          ),
          ...editingOrder.fees.filter(
            (fee) => !state.config.fees.some((current) => current.id === fee.id)
          )
        ]
      }
    : state.config;
  const adminAction = (next: Dialog) => {
    if (session.isAdmin) setDialog(next);
    else setDialog({ kind: 'settings', tab: 'security' });
  };
  const addItem = (item: MenuItem, variant?: Variant) => {
    setDraft((previous) => {
      const existing = previous.lines.find(
        (line) => line.menuItemId === item.id && line.variantId === variant?.id && !line.notes
      );
      if (existing)
        return {
          ...previous,
          lines: previous.lines.map((line) =>
            line.id === existing.id ? { ...line, quantity: Math.min(999, line.quantity + 1) } : line
          )
        };
      return {
        ...previous,
        lines: [
          ...previous.lines,
          {
            id: uid(),
            menuItemId: item.id,
            name: item.name,
            variantId: variant?.id,
            variantName: variant?.name,
            quantity: 1,
            unitPrice: variant?.price ?? item.price,
            recipe: structuredClone(variant?.recipe.length ? variant.recipe : item.recipe),
            notes: ''
          }
        ]
      };
    });
    setDialog(null);
  };
  const saveOrder = async () => {
    if (!draft.lines.length) return;
    if (draft.fulfillment === 'delivery' && !draft.address.trim()) {
      setError('Add a delivery address under Customer & order notes.');
      return;
    }
    const previousIds = new Set(state.orders.map((order) => order.id));
    const next = await run({ type: 'save-order', draft });
    if (next) {
      const saved = draft.id
        ? next.state.orders.find((order) => order.id === draft.id)
        : next.state.orders.find((order) => !previousIds.has(order.id));
      setDraft(emptyDraft());
      setToast('');
      if (saved) setDialog({ kind: 'receipt', order: saved, justSaved: true });
      else setToast('Order saved.');
    }
  };
  const clear = () =>
    setDialog({
      kind: 'confirm',
      title: draft.expectedRevision !== undefined ? 'Discard order changes?' : 'Clear this order?',
      text:
        draft.expectedRevision !== undefined
          ? 'Your unsaved changes will be discarded. The saved order stays as it is.'
          : 'Remove all items and customer details from the current ticket?',
      label: draft.expectedRevision !== undefined ? 'Discard changes' : 'Clear order',
      danger: true,
      action: () => {
        setDraft(emptyDraft());
        setDialog(null);
      }
    });
  const editOrder = (order: Order) => {
    const begin = () => {
      setDraft(orderDraft(order));
      setTab('menu');
      setDialog(null);
      setToast(`Editing order #${order.number}. Save changes when you’re done.`);
    };
    if (draft.lines.length || draft.expectedRevision !== undefined)
      setDialog({
        kind: 'confirm',
        title: 'Replace the current ticket?',
        text: `Discard the current unsaved ticket and edit order #${order.number}?`,
        label: 'Edit order',
        action: begin
      });
    else begin();
  };
  const complete = (order: Order) =>
    setDialog({
      kind: 'confirm',
      title: `Complete order #${order.number}?`,
      text: 'The ticket will move to Completed. Any configured inventory ingredients will be deducted.',
      label: 'Completed',
      action: async () => {
        const next = await run({
          type: 'complete-order',
          id: order.id,
          expectedRevision: order.revision
        });
        if (next) {
          setDialog(null);
          setToast(`Order #${order.number} completed.`);
        }
      }
    });
  const cancel = (order: Order) =>
    setDialog({
      kind: 'confirm',
      title: `Cancel order #${order.number}?`,
      text: 'The order stays in the cancellation history. Any inventory already consumed by this order will be returned. This does not issue a payment refund.',
      label: 'Cancel order',
      danger: true,
      action: async () => {
        const next = await run({
          type: 'cancel-order',
          id: order.id,
          expectedRevision: order.revision
        });
        if (next) {
          setDialog(null);
          setToast(`Order #${order.number} cancelled.`);
        }
      }
    });
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setTab('menu');
          }}
          aria-label="OpenPOS menu"
        >
          <Logo />
          <span>
            open<span>pos</span>
            <small>GOOD BUSINESS. SIMPLIFIED.</small>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}>
            <I path={mdiViewGridOutline} />
            <span>Menu Items</span>
          </button>
          <button className={tab === 'orders' ? 'active' : ''} onClick={() => setTab('orders')}>
            <I path={mdiReceiptTextOutline} />
            <span>Orders</span>
            {progressCount > 0 && <span className="nav-count">{progressCount}</span>}
          </button>
          {session.isAdmin && (
            <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>
              <I path={mdiChartBoxOutline} />
              <span>Audit</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="admin-control"
            onClick={() => setDialog({ kind: 'settings', tab: 'security' })}
            title="Manage administrator access"
          >
            <span className="avatar">
              <I path={mdiShieldAccountOutline} size={0.9} />
            </span>
            <span>
              <strong>{session.isAdmin ? 'Administrator' : 'Staff workspace'}</strong>
              <small>{device.deviceName}</small>
            </span>
            <I path={mdiArrowRight} size={0.7} />
          </button>
          <div className="connection-status" title={sync.message}>
            <I
              path={device.role === 'standalone' || sync.connected ? mdiWifi : mdiWifiOff}
              size={0.65}
            />
            <span>
              {device.role === 'standalone'
                ? 'Local workspace'
                : sync.connected
                  ? 'Devices connected'
                  : 'Connection unavailable'}
            </span>
            <span
              className={`status-dot ${device.role === 'standalone' || sync.connected ? 'online' : 'offline'}`}
            />
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="business-heading">
            <strong>{state.config.businessName}</strong>
            <span>
              {time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
              <i /> {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="toolbar" aria-label="Application tools">
            <button
              className="toolbar-button"
              title="Create a menu item"
              onClick={() => adminAction({ kind: 'menu' })}
            >
              <I path={mdiPlus} size={0.8} />
              <span>Add item</span>
            </button>
            <button
              className="toolbar-button"
              title="Receive and manage inventory"
              onClick={() => adminAction({ kind: 'inventory' })}
            >
              <I path={mdiPackageVariantClosed} size={0.85} />
              <span>Inventory</span>
            </button>
            <button
              className="toolbar-button"
              title="Business, device and security settings"
              onClick={() => setDialog({ kind: 'settings' })}
            >
              <I path={mdiCogOutline} size={0.85} />
              <span>Configuration</span>
            </button>
            <button
              className="toolbar-button help"
              title="Open the user guide in your browser"
              onClick={() =>
                window.openpos.openHelp().catch((caught) => setError(errorMessage(caught)))
              }
            >
              <I path={mdiHelpCircleOutline} size={0.9} />
              <span>Help</span>
            </button>
          </div>
        </header>
        {!session.passwordSet && (
          <div className="setup-banner">
            <span>
              <strong>Make this workspace yours.</strong> Set an administrator password before your
              first real shift.
            </span>
            <button onClick={() => setDialog({ kind: 'settings', tab: 'security' })}>
              Set up security <I path={mdiArrowRight} size={0.65} />
            </button>
          </div>
        )}
        {snapshot.warning && (
          <div className="warning-banner" role="status">
            {snapshot.warning}
          </div>
        )}
        {device.role === 'client' && !sync.connected && (
          <div className="warning-banner" role="status">
            {sync.message} Order changes require a connection to the primary device.
          </div>
        )}
        {error && (
          <div className="app-error" role="alert">
            <span>{error}</span>
            <button
              className="icon-button"
              title="Dismiss error"
              aria-label="Dismiss error"
              onClick={() => setError('')}
            >
              <I path={mdiClose} size={0.8} />
            </button>
          </div>
        )}
        <main className={`main-content ${tab === 'menu' ? 'menu-layout' : ''}`}>
          {tab === 'menu' ? (
            <>
              <section className="menu-pane">
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">MENU ITEMS</div>
                    <h1>Take an order</h1>
                    <p>Choose an item to build your ticket.</p>
                  </div>
                  {session.isAdmin && (
                    <label className="show-hidden">
                      <input
                        type="checkbox"
                        checked={showHidden}
                        onChange={(event) => {
                          setShowHidden(event.target.checked);
                          setCategory('All items');
                        }}
                      />{' '}
                      Show hidden items
                    </label>
                  )}
                </div>
                <div className="menu-search">
                  <I path={mdiMagnify} size={0.95} />
                  <input
                    aria-label="Search menu"
                    type="search"
                    placeholder="Search menu items…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <span className="search-hint">Find your favourites</span>
                </div>
                <div className="category-row" aria-label="Menu categories">
                  {categories.map((value) => (
                    <button
                      className={`category-chip ${category === value ? 'active' : ''}`}
                      key={value}
                      aria-pressed={category === value}
                      onClick={() => setCategory(value)}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <div className="menu-grid">
                  {menu.map((item) => (
                    <article
                      className={`menu-card ${!item.active ? 'hidden-item' : ''}`}
                      key={item.id}
                    >
                      <button
                        className="menu-card-add"
                        title={item.description || `Add ${item.name} to order`}
                        disabled={busy || !item.active}
                        onClick={() =>
                          item.variants.length
                            ? setDialog({ kind: 'variant', item })
                            : addItem(item)
                        }
                      >
                        <span
                          className="menu-art"
                          style={{
                            background: `color-mix(in srgb, ${item.color || '#e9f0dc'} 30%, white)`
                          }}
                        >
                          <I path={icons[item.icon] ?? icons.food} size={2.2} />
                          <span className="art-circle" />
                          <span className="art-dot" />
                        </span>
                        <span className="menu-card-info">
                          <span className="menu-category">
                            {item.category}
                            {!item.active ? ' · Hidden' : ''}
                          </span>
                          <strong>{item.name}</strong>
                          <span className="menu-description">
                            {item.description ||
                              (item.variants.length
                                ? `${item.variants.length} options available`
                                : 'An everyday favourite')}
                          </span>
                          <span className="menu-card-bottom">
                            <span>
                              {item.variants.length ? (
                                <>
                                  <small>from </small>
                                  {fmt(Math.min(...item.variants.map((variant) => variant.price)))}
                                </>
                              ) : (
                                fmt(item.price)
                              )}
                            </span>
                            <span className="card-plus">
                              <I path={mdiPlus} size={0.8} />
                            </span>
                          </span>
                        </span>
                      </button>
                      {session.isAdmin && (
                        <button
                          className="menu-edit"
                          title={`Edit ${item.name}`}
                          aria-label={`Edit ${item.name}`}
                          onClick={() => setDialog({ kind: 'menu', item })}
                        >
                          <I path={mdiPencilOutline} size={0.75} />
                        </button>
                      )}
                    </article>
                  ))}
                </div>
                {!menu.length && (
                  <Empty
                    path={mdiMagnify}
                    title="No items found"
                    text="Try another search or category, or add a menu item."
                  />
                )}
                <div className="menu-bottom-note">
                  <span className="status-dot online" /> Place an order to save the ticket.
                </div>
              </section>
              <Cart
                draft={draft}
                config={cartConfig}
                busy={busy}
                editingNumber={editingOrder?.number}
                onChange={setDraft}
                onSubmit={saveOrder}
                onClear={clear}
              />
            </>
          ) : tab === 'orders' ? (
            <Orders
              snapshot={snapshot}
              busy={busy}
              onEdit={editOrder}
              onReceipt={(order) => setDialog({ kind: 'receipt', order })}
              onComplete={complete}
              onCancel={cancel}
            />
          ) : session.isAdmin ? (
            <Audit snapshot={snapshot} />
          ) : null}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <I path={mdiCheck} size={0.85} />
          {toast}
        </div>
      )}
      {dialog?.kind === 'menu' && (
        <MenuEditor
          key={dialog.item?.id ?? 'new'}
          item={dialog.item}
          snapshot={snapshot}
          onClose={() => setDialog(null)}
          onSaved={setSnapshot}
        />
      )}{' '}
      {dialog?.kind === 'inventory' && (
        <Inventory snapshot={snapshot} onClose={() => setDialog(null)} onSaved={setSnapshot} />
      )}{' '}
      {dialog?.kind === 'settings' && (
        <Settings
          snapshot={snapshot}
          initialTab={dialog.tab}
          onClose={() => setDialog(null)}
          onSaved={setSnapshot}
        />
      )}{' '}
      {dialog?.kind === 'receipt' && (
        <Receipt
          order={dialog.order}
          snapshot={snapshot}
          justSaved={dialog.justSaved}
          onClose={() => setDialog(null)}
        />
      )}{' '}
      {dialog?.kind === 'variant' && (
        <Modal title={dialog.item.name} subtitle="Choose an option" onClose={() => setDialog(null)}>
          <div className="modal-body">
            <p className="muted">{dialog.item.description}</p>
            <div className="variant-options">
              {dialog.item.variants.map((variant) => (
                <button
                  className="variant-choice"
                  key={variant.id}
                  onClick={() => addItem(dialog.item, variant)}
                >
                  <span>
                    <strong>{variant.name}</strong>
                    <small>Tap to add to the order</small>
                  </span>
                  <strong>{fmt(variant.price)}</strong>
                  <I path={mdiPlus} size={0.9} />
                </button>
              ))}
            </div>
          </div>
        </Modal>
      )}{' '}
      {dialog?.kind === 'confirm' && (
        <Modal title={dialog.title} onClose={() => !busy && setDialog(null)}>
          <div className="modal-body">
            <p>{dialog.text}</p>
            {error && <ErrorText error={error} />}
          </div>
          <footer className="modal-footer">
            <button className="secondary" disabled={busy} onClick={() => setDialog(null)}>
              Go back
            </button>
            <button
              className={dialog.danger ? 'danger-button' : 'primary'}
              disabled={busy}
              onClick={() => void dialog.action()}
            >
              {busy ? 'Saving…' : dialog.label}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
