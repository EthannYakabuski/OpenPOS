import React, { useState } from 'react';
import { mdiPlus, mdiTrashCanOutline } from '@mdi/js';
import type { Ingredient, InventoryItem, MenuItem, Snapshot, Variant } from '../shared/types';
import { cents, priceInput, uid } from './helpers';
import { ErrorText, Field, I, Modal, Toggle, errorMessage, icons } from './ui';

function RecipeEditor({
  recipe,
  inventory,
  onChange
}: {
  recipe: Ingredient[];
  inventory: InventoryItem[];
  onChange: (value: Ingredient[]) => void;
}) {
  return (
    <div className="recipe-editor">
      {recipe.map((ingredient, index) => (
        <div className="recipe-row" key={index}>
          <Field label="Inventory item">
            <select
              required
              value={ingredient.inventoryId}
              onChange={(event) =>
                onChange(
                  recipe.map((row, i) =>
                    i === index ? { ...row, inventoryId: event.target.value } : row
                  )
                )
              }
            >
              <option value="">Select inventory…</option>
              {inventory.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name} ({item.unit})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Amount consumed">
            <input
              required
              type="number"
              min="0.001"
              step="0.001"
              value={ingredient.quantity}
              onChange={(event) =>
                onChange(
                  recipe.map((row, i) =>
                    i === index ? { ...row, quantity: Number(event.target.value) } : row
                  )
                )
              }
            />
          </Field>
          <button
            type="button"
            className="icon-button danger"
            title="Remove ingredient"
            aria-label="Remove ingredient"
            onClick={() => onChange(recipe.filter((_, i) => i !== index))}
          >
            <I path={mdiTrashCanOutline} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={!inventory.length}
        onClick={() => onChange([...recipe, { inventoryId: inventory[0]?.id ?? '', quantity: 1 }])}
      >
        <I path={mdiPlus} size={0.8} /> Add inventory ingredient
      </button>
      {!inventory.length && (
        <p className="muted">Create inventory items from the Inventory toolbar first.</p>
      )}
    </div>
  );
}
export function MenuEditor({
  item,
  snapshot,
  onClose,
  onSaved
}: {
  item?: MenuItem;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: (snapshot: Snapshot) => void;
}) {
  const [form, setForm] = useState<MenuItem>(() =>
    item
      ? structuredClone(item)
      : {
          id: uid(),
          name: '',
          category: 'Food',
          description: '',
          price: 0,
          variants: [],
          recipe: [],
          color: '#e9f0dc',
          icon: 'pizza',
          active: true,
          updatedAt: new Date().toISOString()
        }
  );
  const [basePrice, setBasePrice] = useState(priceInput(form.price));
  const [variantPrices, setVariantPrices] = useState<Record<string, string>>(
    Object.fromEntries(form.variants.map((variant) => [variant.id, priceInput(variant.price)]))
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision] = useState(snapshot.state.revision);
  const patch = (value: Partial<MenuItem>) => setForm((previous) => ({ ...previous, ...value }));
  const patchVariant = (id: string, value: Partial<Variant>) =>
    patch({
      variants: form.variants.map((variant) =>
        variant.id === id ? { ...variant, ...value } : variant
      )
    });
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.name.trim() || !form.category.trim()) {
      setError('Enter an item name and category.');
      return;
    }
    if (form.variants.some((variant) => !variant.name.trim())) {
      setError('Give every size or type a name.');
      return;
    }
    const prepared = {
      ...form,
      name: form.name.trim(),
      category: form.category.trim(),
      price: cents(basePrice),
      variants: form.variants.map((variant) => ({
        ...variant,
        name: variant.name.trim(),
        price: cents(variantPrices[variant.id] ?? '0')
      }))
    };
    if (
      [prepared.price, ...prepared.variants.map((variant) => variant.price)].some(
        (value) => !Number.isSafeInteger(value) || value < 0
      )
    ) {
      setError('Prices must be positive amounts or zero, with no more than two decimal places.');
      return;
    }
    setBusy(true);
    try {
      onSaved(
        await window.openpos.execute({
          type: 'save-menu',
          item: prepared,
          expectedRevision: revision
        })
      );
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={item ? 'Edit menu item' : 'Add menu item'}
      subtitle="Build your menu, one good thing at a time."
      onClose={() => !busy && onClose()}
      wide
    >
      <form onSubmit={save}>
        <div className="modal-body">
          <ErrorText error={error} />
          <div className="form-grid">
            <Field label="Item name">
              <input
                autoFocus
                required
                maxLength={100}
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="e.g. Margherita pizza"
              />
            </Field>
            <Field label="Category">
              <input
                required
                maxLength={60}
                value={form.category}
                list="menu-categories"
                onChange={(event) => patch({ category: event.target.value })}
              />
              <datalist id="menu-categories">
                {[...new Set(snapshot.state.menu.map((row) => row.category))].map((category) => (
                  <option key={category} value={category} />
                ))}
              </datalist>
            </Field>
            <Field label="Base price" hint="Used when the item has no size or type options.">
              <input
                type="number"
                min="0"
                max="100000"
                step="0.01"
                required
                value={basePrice}
                onChange={(event) => setBasePrice(event.target.value)}
              />
            </Field>
            <Field label="Menu icon">
              <select
                value={form.icon in icons ? form.icon : 'food'}
                onChange={(event) => patch({ icon: event.target.value })}
              >
                {Object.keys(icons).map((name) => (
                  <option key={name} value={name}>
                    {name[0].toUpperCase() + name.slice(1)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description (optional)">
            <textarea
              rows={2}
              maxLength={500}
              value={form.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="A little detail to help the team take orders"
            />
          </Field>
          <Field label="Card accent">
            <div className="color-options">
              {['#e9f0dc', '#ffead4', '#e2edf6', '#f4e3e7', '#eee5f6', '#f8efc9'].map((color) => (
                <button
                  type="button"
                  key={color}
                  className={`color-swatch ${form.color === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  aria-label={`Choose ${color} accent`}
                  aria-pressed={form.color === color}
                  onClick={() => patch({ color })}
                />
              ))}
            </div>
          </Field>
          <section className="editor-section">
            <div className="section-heading">
              <div>
                <h3>Sizes & types</h3>
                <p>Each option has its own complete price.</p>
              </div>
              <button
                className="secondary small"
                type="button"
                onClick={() => {
                  const id = uid();
                  patch({ variants: [...form.variants, { id, name: '', price: 0, recipe: [] }] });
                  setVariantPrices((previous) => ({ ...previous, [id]: basePrice }));
                }}
              >
                <I path={mdiPlus} size={0.8} /> Add option
              </button>
            </div>
            {form.variants.map((variant) => (
              <div className="variant-editor" key={variant.id}>
                <div className="recipe-row">
                  <Field label="Option name">
                    <input
                      required
                      maxLength={60}
                      value={variant.name}
                      onChange={(event) => patchVariant(variant.id, { name: event.target.value })}
                      placeholder="e.g. Large"
                    />
                  </Field>
                  <Field label="Price">
                    <input
                      required
                      type="number"
                      min="0"
                      max="100000"
                      step="0.01"
                      value={variantPrices[variant.id] ?? '0'}
                      onChange={(event) =>
                        setVariantPrices((previous) => ({
                          ...previous,
                          [variant.id]: event.target.value
                        }))
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Remove ${variant.name || 'option'}`}
                    title="Remove option"
                    onClick={() =>
                      patch({ variants: form.variants.filter((row) => row.id !== variant.id) })
                    }
                  >
                    <I path={mdiTrashCanOutline} />
                  </button>
                </div>
                <details>
                  <summary>Inventory recipe for this option</summary>
                  <p className="muted">Leave empty to use the base recipe below.</p>
                  <RecipeEditor
                    recipe={variant.recipe}
                    inventory={snapshot.state.inventory}
                    onChange={(recipe) => patchVariant(variant.id, { recipe })}
                  />
                </details>
              </div>
            ))}
          </section>
          <section className="editor-section">
            <h3>Inventory consumption (optional)</h3>
            <p className="muted">
              Deduct these quantities when an order is completed. Size recipes override this base
              recipe.
            </p>
            <RecipeEditor
              recipe={form.recipe}
              inventory={snapshot.state.inventory}
              onChange={(recipe) => patch({ recipe })}
            />
          </section>
          <Toggle
            checked={form.active}
            onChange={(active) => patch({ active })}
            label="Available on the menu"
            detail="Hide an item without changing past orders."
          />
        </div>
        <footer className="modal-footer">
          <button type="button" className="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save menu item'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
