import React, { useState } from 'react';
import { mdiPackageVariantClosed, mdiPlus, mdiPencilOutline, mdiArrowLeft } from '@mdi/js';
import type { InventoryItem, Snapshot } from '../shared/types';
import { uid } from './helpers';
import { Empty, ErrorText, Field, I, Modal, errorMessage } from './ui';

export function Inventory({
  snapshot,
  onClose,
  onSaved
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: (snapshot: Snapshot) => void;
}) {
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [restocking, setRestocking] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editRevision, setEditRevision] = useState(snapshot.state.revision);
  const beginEdit = (item: InventoryItem) => {
    setEditRevision(snapshot.state.revision);
    setEditing(item);
  };
  const back = () => {
    setEditing(null);
    setRestocking(null);
    setError('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (editing)
        onSaved(
          await window.openpos.execute({
            type: 'save-inventory',
            item: { ...editing, name: editing.name.trim(), unit: editing.unit.trim() },
            expectedRevision: editRevision
          })
        );
      if (restocking)
        onSaved(
          await window.openpos.execute({
            type: 'restock',
            inventoryId: restocking.id,
            quantity: Number(quantity),
            note: note.trim() || 'Stock received'
          })
        );
      back();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  const items = snapshot.state.inventory.filter((item) =>
    `${item.name} ${item.unit}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <Modal
      title="Inventory"
      subtitle="Know what’s on hand. Keep your kitchen moving."
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="modal-body">
        <ErrorText error={error} />
        {editing || restocking ? (
          <form id="inventory-form" onSubmit={submit}>
            <button type="button" className="text-button" onClick={back}>
              <I path={mdiArrowLeft} size={0.8} /> Back to inventory
            </button>
            {editing ? (
              <>
                <h3>
                  {snapshot.state.inventory.some((item) => item.id === editing.id)
                    ? 'Edit inventory item'
                    : 'New inventory item'}
                </h3>
                <div className="form-grid">
                  <Field label="Item name">
                    <input
                      required
                      autoFocus
                      maxLength={100}
                      value={editing.name}
                      onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                      placeholder="e.g. Pizza dough"
                    />
                  </Field>
                  <Field label="Unit">
                    <input
                      required
                      maxLength={30}
                      value={editing.unit}
                      onChange={(event) => setEditing({ ...editing, unit: event.target.value })}
                      placeholder="e.g. each, kg, litre"
                    />
                  </Field>
                  <Field
                    label="Quantity on hand"
                    hint="Changing this value records an inventory adjustment."
                  >
                    <input
                      required
                      type="number"
                      step="0.001"
                      value={editing.quantity}
                      onChange={(event) =>
                        setEditing({ ...editing, quantity: Number(event.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Low stock alert at">
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.001"
                      value={editing.lowStockAt}
                      onChange={(event) =>
                        setEditing({ ...editing, lowStockAt: Number(event.target.value) })
                      }
                    />
                  </Field>
                </div>
              </>
            ) : (
              restocking && (
                <>
                  <h3>Receive {restocking.name}</h3>
                  <p className="muted">
                    Currently {restocking.quantity.toLocaleString()} {restocking.unit} on hand.
                  </p>
                  <div className="form-grid">
                    <Field label={`Quantity received (${restocking.unit})`}>
                      <input
                        autoFocus
                        required
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={quantity}
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </Field>
                    <Field label="Purchase note (optional)">
                      <input
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        placeholder="Supplier or invoice reference"
                      />
                    </Field>
                  </div>
                </>
              )
            )}
          </form>
        ) : (
          <>
            <div className="inventory-top">
              <input
                className="search-input"
                aria-label="Search inventory"
                placeholder="Search inventory…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button
                type="button"
                className="primary"
                onClick={() =>
                  beginEdit({
                    id: uid(),
                    name: '',
                    unit: 'each',
                    quantity: 0,
                    lowStockAt: 5,
                    updatedAt: new Date().toISOString()
                  })
                }
              >
                <I path={mdiPlus} size={0.85} /> New item
              </button>
            </div>
            {!snapshot.state.config.inventoryEnabled && (
              <div className="notice">
                Inventory deduction is off. Enable it in Configuration → Business to consume stock
                on completed orders.
              </div>
            )}
            {items.length ? (
              <div className="inventory-list">
                {items.map((item) => (
                  <div className="inventory-row" key={item.id}>
                    <span
                      className={`inventory-icon ${item.quantity <= item.lowStockAt ? 'low' : ''}`}
                    >
                      <I path={mdiPackageVariantClosed} />
                    </span>
                    <div className="inventory-name">
                      <strong>{item.name}</strong>
                      <small>
                        {item.quantity <= item.lowStockAt ? 'Low stock · ' : ''}Alert at{' '}
                        {item.lowStockAt} {item.unit}
                      </small>
                    </div>
                    <div className="stock-count">
                      <strong>{item.quantity.toLocaleString()}</strong>
                      <small>{item.unit}</small>
                    </div>
                    <button
                      className="secondary small"
                      title={`Receive purchased ${item.name}`}
                      onClick={() => {
                        setRestocking(item);
                        setQuantity('1');
                        setNote('');
                      }}
                    >
                      Receive
                    </button>
                    <button
                      className="icon-button"
                      title={`Edit ${item.name}`}
                      aria-label={`Edit ${item.name}`}
                      onClick={() => beginEdit(structuredClone(item))}
                    >
                      <I path={mdiPencilOutline} size={0.85} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <Empty
                path={mdiPackageVariantClosed}
                title="No inventory items"
                text="Add an item to track purchased stock and recipe consumption."
              />
            )}
          </>
        )}
      </div>
      <footer className="modal-footer">
        <button
          className="secondary"
          disabled={busy}
          onClick={editing || restocking ? back : onClose}
        >
          {editing || restocking ? 'Cancel' : 'Close'}
        </button>
        {(editing || restocking) && (
          <button className="primary" disabled={busy} type="submit" form="inventory-form">
            {busy ? 'Saving…' : editing ? 'Save inventory item' : 'Receive stock'}
          </button>
        )}
      </footer>
    </Modal>
  );
}
