import React, { useState } from 'react';
import {
  mdiContentCopy,
  mdiFolderOpenOutline,
  mdiShieldLockOutline,
  mdiPlus,
  mdiTrashCanOutline,
  mdiBackupRestore
} from '@mdi/js';
import type { BusinessConfig, DeviceConfig, Snapshot } from '../shared/types';
import { cents, priceInput, uid } from './helpers';
import { ErrorText, Field, I, Modal, Toggle, errorMessage } from './ui';

export function Settings({
  snapshot,
  initialTab = 'business',
  onClose,
  onSaved
}: {
  snapshot: Snapshot;
  initialTab?: 'business' | 'device' | 'security';
  onClose: () => void;
  onSaved: (snapshot: Snapshot) => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [config, setConfig] = useState<BusinessConfig>(structuredClone(snapshot.state.config));
  const [device, setDevice] = useState<DeviceConfig>(structuredClone(snapshot.device));
  const [revision] = useState(snapshot.state.revision);
  const [feePrices, setFeePrices] = useState<Record<string, string>>(
    Object.fromEntries(config.fees.map((fee) => [fee.id, priceInput(fee.amount)]))
  );
  const [password, setPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetPhrase, setResetPhrase] = useState('');
  const patch = (value: Partial<BusinessConfig>) =>
    setConfig((previous) => ({ ...previous, ...value }));
  const local = (value: Partial<DeviceConfig>) =>
    setDevice((previous) => ({ ...previous, ...value }));
  const action = async (work: () => Promise<Snapshot | void | string | null>, message = '') => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const result = await work();
      if (result && typeof result === 'object') onSaved(result);
      setNotice(typeof result === 'string' ? `Saved to ${result}` : message);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (tab === 'business') {
      if (
        !config.businessName.trim() ||
        !Number.isFinite(config.taxRate) ||
        config.taxRate < 0 ||
        config.taxRate > 100
      ) {
        setError('Enter a business name and a tax percentage between 0 and 100.');
        return;
      }
      const prepared = {
        ...config,
        businessName: config.businessName.trim(),
        fees: config.fees.map((fee) => ({
          ...fee,
          name: fee.name.trim(),
          amount: cents(feePrices[fee.id] ?? '0')
        }))
      };
      if (
        prepared.fees.some(
          (fee) => !fee.name || !Number.isSafeInteger(fee.amount) || fee.amount < 0
        )
      ) {
        setError('Every fee needs a name and a valid non-negative price.');
        return;
      }
      if (
        await action(() =>
          window.openpos.execute({
            type: 'save-config',
            config: prepared,
            expectedRevision: revision
          })
        )
      )
        onClose();
    } else if (tab === 'device') {
      if (!device.deviceName.trim()) {
        setError('Enter a name for this device.');
        return;
      }
      if (device.role !== 'standalone' && (!device.syncKey.trim() || device.syncKey.length < 24)) {
        setError('Use a shared connection key of at least 24 characters.');
        return;
      }
      if (device.role === 'client') {
        try {
          const url = new URL(device.serverUrl);
          if (url.protocol !== 'http:') throw new Error();
        } catch {
          setError('Enter the primary device URL, for example http://192.168.1.10:3210.');
          return;
        }
      }
      if (
        await action(() =>
          window.openpos.saveDevice({ ...device, deviceName: device.deviceName.trim() })
        )
      )
        onClose();
    }
  };
  const security = async (event: React.FormEvent) => {
    event.preventDefault();
    if (snapshot.session.isAdmin) {
      if (password.length < 8) {
        setError('Use at least 8 characters for the administrator password.');
        return;
      }
      if (password !== confirmation) {
        setError('The new password and confirmation do not match.');
        return;
      }
      if (
        await action(
          () => window.openpos.setPassword(password, currentPassword || undefined),
          'Administrator password saved. Store it somewhere safe.'
        )
      ) {
        setPassword('');
        setConfirmation('');
        setCurrentPassword('');
      }
    } else if (
      await action(
        () => window.openpos.unlock(password),
        'Administrator controls are unlocked on this device.'
      )
    ) {
      setPassword('');
    }
  };
  const startFresh = async () => {
    if (resetPhrase !== 'START FRESH') {
      setError('Type START FRESH exactly to begin a new sales ledger.');
      return;
    }
    if (
      await action(
        () =>
          window.openpos.execute({
            type: 'start-fresh',
            confirmation: resetPhrase,
            expectedRevision: snapshot.state.revision
          }),
        'A backup was created. Orders and inventory movements have been cleared; stock quantities are now zero.'
      )
    ) {
      setResetPhrase('');
      onClose();
    }
  };
  return (
    <Modal
      title="Configuration"
      subtitle="Your business. Your workflow."
      onClose={() => !busy && onClose()}
      wide
    >
      <div className="dialog-tabs" role="tablist" aria-label="Configuration sections">
        {(['business', 'device', 'security'] as const).map((value) => (
          <button
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
            key={value}
            onClick={() => {
              setTab(value);
              setError('');
              setNotice('');
            }}
          >
            {value === 'business' ? 'Business' : value === 'device' ? 'This device' : 'Security'}
          </button>
        ))}
      </div>
      <div className="modal-body">
        <ErrorText error={error} />
        {notice && (
          <div className="success-notice" role="status">
            {notice}
          </div>
        )}
        {tab !== 'security' && !snapshot.session.isAdmin ? (
          <div className="locked-panel">
            <I path={mdiShieldLockOutline} size={2} />
            <h3>Administrator controls are locked</h3>
            <p>Unlock this device to change business settings, manage inventory or view sales.</p>
            <button className="primary" onClick={() => setTab('security')}>
              Unlock administrator
            </button>
          </div>
        ) : tab === 'business' ? (
          <form id="settings-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Business name">
                <input
                  required
                  maxLength={100}
                  value={config.businessName}
                  onChange={(event) => patch({ businessName: event.target.value })}
                />
              </Field>
              <Field label="Currency">
                <select
                  value={config.currency}
                  onChange={(event) => patch({ currency: event.target.value })}
                >
                  {['CAD', 'USD', 'EUR', 'GBP', 'AUD', 'NZD'].map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sales tax (%)" hint="Applied to menu items and fees marked taxable.">
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  value={config.taxRate}
                  onChange={(event) => patch({ taxRate: Number(event.target.value) })}
                />
              </Field>
              <Field label="Receipt footer">
                <input
                  maxLength={250}
                  value={config.receiptFooter}
                  onChange={(event) => patch({ receiptFooter: event.target.value })}
                />
              </Field>
            </div>
            <Toggle
              checked={config.autoCompleteOrders}
              onChange={(autoCompleteOrders) => patch({ autoCompleteOrders })}
              label="Auto Complete Orders"
              detail="For counter sales: complete new orders immediately and deduct inventory."
            />
            <Toggle
              checked={config.inventoryEnabled}
              onChange={(inventoryEnabled) => patch({ inventoryEnabled })}
              label="Track inventory consumption"
              detail="Deduct recipe quantities when orders are completed. Low stock remains visible."
            />
            <section className="editor-section">
              <div className="section-heading">
                <div>
                  <h3>Order fees</h3>
                  <p>Staff select applicable fees in the current order.</p>
                </div>
                <button
                  type="button"
                  className="secondary small"
                  onClick={() => {
                    const id = uid();
                    patch({ fees: [...config.fees, { id, name: '', amount: 0, taxable: true }] });
                    setFeePrices((previous) => ({ ...previous, [id]: '0.00' }));
                  }}
                >
                  <I path={mdiPlus} size={0.8} /> Add fee
                </button>
              </div>
              {config.fees.map((fee) => (
                <div className="fee-editor" key={fee.id}>
                  <Field label="Fee name">
                    <input
                      required
                      maxLength={80}
                      value={fee.name}
                      onChange={(event) =>
                        patch({
                          fees: config.fees.map((row) =>
                            row.id === fee.id ? { ...row, name: event.target.value } : row
                          )
                        })
                      }
                    />
                  </Field>
                  <Field label="Amount">
                    <input
                      required
                      type="number"
                      min="0"
                      max="100000"
                      step="0.01"
                      value={feePrices[fee.id] ?? '0.00'}
                      onChange={(event) =>
                        setFeePrices((previous) => ({ ...previous, [fee.id]: event.target.value }))
                      }
                    />
                  </Field>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={fee.taxable}
                      onChange={(event) =>
                        patch({
                          fees: config.fees.map((row) =>
                            row.id === fee.id ? { ...row, taxable: event.target.checked } : row
                          )
                        })
                      }
                    />{' '}
                    Taxable
                  </label>
                  <button
                    type="button"
                    className="icon-button danger"
                    title="Remove fee"
                    aria-label={`Remove ${fee.name || 'fee'}`}
                    onClick={() => patch({ fees: config.fees.filter((row) => row.id !== fee.id) })}
                  >
                    <I path={mdiTrashCanOutline} />
                  </button>
                </div>
              ))}
            </section>
            <section className="editor-section">
              <h3>Business data</h3>
              <p className="muted">
                JSON data is stored at <code className="path-text">{snapshot.dataPath}</code>. Make
                a backup before editing files manually.
              </p>
              <div className="button-row">
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => action(() => window.openpos.openDataFolder())}
                >
                  <I path={mdiFolderOpenOutline} size={0.85} /> Open data folder
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => action(() => window.openpos.backup())}
                >
                  <I path={mdiBackupRestore} size={0.85} /> Create backup
                </button>
              </div>
            </section>
            <section className="editor-section">
              <h3>Begin a new sales ledger</h3>
              <p className="muted">
                When you are ready to leave the demonstration behind, start fresh. This creates a
                backup, clears all orders and inventory movements, and sets every inventory quantity
                to zero. Your menu and configuration stay in place. Receive your real stock before
                trading.
              </p>
              <Field label="Type START FRESH to confirm">
                <input
                  value={resetPhrase}
                  onChange={(event) => setResetPhrase(event.target.value)}
                  autoComplete="off"
                  placeholder="START FRESH"
                />
              </Field>
              <button
                type="button"
                className="danger-button"
                disabled={busy || resetPhrase !== 'START FRESH'}
                onClick={startFresh}
              >
                Start fresh
              </button>
            </section>
          </form>
        ) : tab === 'device' ? (
          <form id="settings-form" onSubmit={submit}>
            <div className="form-grid">
              <Field label="Device name">
                <input
                  required
                  maxLength={80}
                  value={device.deviceName}
                  onChange={(event) => local({ deviceName: event.target.value })}
                />
              </Field>
              <Field label="Open on launch">
                <select
                  value={device.defaultTab}
                  onChange={(event) =>
                    local({ defaultTab: event.target.value as DeviceConfig['defaultTab'] })
                  }
                >
                  <option value="menu">Menu Items</option>
                  <option value="orders">Orders</option>
                </select>
              </Field>
            </div>
            <Field label="Connection mode">
              <select
                value={device.role}
                onChange={(event) => local({ role: event.target.value as DeviceConfig['role'] })}
              >
                <option value="standalone">Standalone — only this device</option>
                <option value="master">Primary (master) — share business data</option>
                <option value="client">Client — connect to the primary device</option>
              </select>
            </Field>
            <p className="muted">
              Use one primary device per business. Connected clients share its menu, orders,
              inventory and business settings. Administrator access remains local to each device.
            </p>
            {device.role !== 'standalone' && (
              <>
                <div className="form-grid">
                  {device.role === 'master' ? (
                    <Field label="Listening port">
                      <input
                        required
                        type="number"
                        min="1024"
                        max="65535"
                        step="1"
                        value={device.port}
                        onChange={(event) => local({ port: Number(event.target.value) })}
                      />
                    </Field>
                  ) : (
                    <Field
                      label="Primary device URL"
                      hint="Use the primary device’s local network address."
                    >
                      <input
                        required
                        type="url"
                        value={device.serverUrl}
                        onChange={(event) => local({ serverUrl: event.target.value })}
                        placeholder="http://192.168.1.10:3210"
                      />
                    </Field>
                  )}
                  <Field
                    label="Shared connection key"
                    hint="Enter the same key on the primary and each client."
                  >
                    <input
                      required
                      minLength={24}
                      type="password"
                      autoComplete="off"
                      value={device.syncKey}
                      onChange={(event) => local({ syncKey: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => local({ syncKey: uid() + uid().slice(0, 8) })}
                  >
                    Generate connection key
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={!device.syncKey}
                    onClick={() =>
                      action(async () => {
                        await navigator.clipboard.writeText(device.syncKey);
                      }, 'Connection key copied. Paste it into the other device’s settings.')
                    }
                  >
                    <I path={mdiContentCopy} size={0.8} /> Copy key
                  </button>
                </div>
                <div className="notice">
                  Connect only over a trusted private business network. Keep the primary device
                  running. Client changes require a live connection.
                </div>
                {device.role === 'client' ? (
                  <Field
                    label="This client’s ID"
                    hint="Copy this ID into the primary device’s registered clients list."
                  >
                    <div className="copy-field">
                      <input readOnly value={device.clientId} />
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="Copy client ID"
                        onClick={() =>
                          action(async () => {
                            await navigator.clipboard.writeText(device.clientId);
                          }, 'Client ID copied.')
                        }
                      >
                        <I path={mdiContentCopy} />
                      </button>
                    </div>
                  </Field>
                ) : (
                  <section className="editor-section">
                    <div className="section-heading">
                      <div>
                        <h3>Registered clients</h3>
                        <p>Add the ID shown in each client’s settings.</p>
                      </div>
                      <button
                        className="secondary small"
                        type="button"
                        onClick={() =>
                          local({
                            registeredClients: [...device.registeredClients, { id: '', name: '' }]
                          })
                        }
                      >
                        <I path={mdiPlus} size={0.8} /> Register client
                      </button>
                    </div>
                    {device.registeredClients.map((client, index) => (
                      <div className="recipe-row" key={index}>
                        <Field label="Client name">
                          <input
                            required
                            value={client.name}
                            onChange={(event) =>
                              local({
                                registeredClients: device.registeredClients.map((row, i) =>
                                  i === index ? { ...row, name: event.target.value } : row
                                )
                              })
                            }
                          />
                        </Field>
                        <Field label="Client ID">
                          <input
                            required
                            value={client.id}
                            onChange={(event) =>
                              local({
                                registeredClients: device.registeredClients.map((row, i) =>
                                  i === index ? { ...row, id: event.target.value } : row
                                )
                              })
                            }
                          />
                        </Field>
                        <button
                          className="icon-button danger"
                          type="button"
                          aria-label={`Remove client ${client.name}`}
                          onClick={() =>
                            local({
                              registeredClients: device.registeredClients.filter(
                                (_, i) => i !== index
                              )
                            })
                          }
                        >
                          <I path={mdiTrashCanOutline} />
                        </button>
                      </div>
                    ))}
                  </section>
                )}
              </>
            )}
          </form>
        ) : (
          <>
            <div className="security-status">
              <span className={`status-dot ${snapshot.session.isAdmin ? 'online' : ''}`} />
              <strong>
                {snapshot.session.isAdmin
                  ? 'Administrator unlocked on this device'
                  : 'Staff mode on this device'}
              </strong>
            </div>
            {!snapshot.session.passwordSet && (
              <div className="notice">
                Set an administrator password before using OpenPOS in your business. Until then,
                administrator controls are available.
              </div>
            )}
            <form id="security-form" onSubmit={security}>
              {snapshot.session.isAdmin ? (
                <>
                  <h3>
                    {snapshot.session.passwordSet
                      ? 'Change administrator password'
                      : 'Set administrator password'}
                  </h3>
                  {snapshot.session.passwordSet && (
                    <Field label="Current password">
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                      />
                    </Field>
                  )}
                  <div className="form-grid">
                    <Field label="New password" hint="At least 8 characters.">
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                    </Field>
                    <Field label="Confirm new password">
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                      />
                    </Field>
                  </div>
                  <button type="submit" className="primary" disabled={busy}>
                    {busy ? 'Saving…' : 'Save password'}
                  </button>
                </>
              ) : (
                <>
                  <h3>Unlock administrator</h3>
                  <p className="muted">
                    Unlock Audit, menu editing, inventory and configuration on this device.
                  </p>
                  <Field label="Administrator password">
                    <input
                      autoFocus
                      required
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </Field>
                  <button type="submit" className="primary" disabled={busy}>
                    {busy ? 'Unlocking…' : 'Unlock administrator'}
                  </button>
                </>
              )}
            </form>
            {snapshot.session.isAdmin && snapshot.session.passwordSet && (
              <section className="editor-section">
                <h3>Return to staff mode</h3>
                <p className="muted">
                  Staff can take, edit and complete orders. Locking hides sales reports and protects
                  administrator controls.
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    action(() => window.openpos.lock(), 'Administrator controls are locked.')
                  }
                >
                  <I path={mdiShieldLockOutline} size={0.85} /> Lock administrator
                </button>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="modal-footer">
        <button className="secondary" disabled={busy} onClick={onClose}>
          Close
        </button>
        {tab !== 'security' && snapshot.session.isAdmin && (
          <button type="submit" form="settings-form" className="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save configuration'}
          </button>
        )}
      </footer>
    </Modal>
  );
}
