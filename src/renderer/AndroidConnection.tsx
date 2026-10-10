import React, { useEffect, useState } from 'react';
import { mdiContentCopy, mdiWifi, mdiShieldLockOutline } from '@mdi/js';
import type { Snapshot } from '../shared/types';
import { ErrorText, Field, I, errorMessage } from './ui';

type Connection = {
  deviceName: string;
  clientId: string;
  serverUrl: string;
  defaultTab: 'menu' | 'orders';
  configured: boolean;
};

/** Connection secrets are entered here, never returned by the platform API. */
export function AndroidConnection({
  snapshot,
  onSaved,
  onUnlock
}: {
  snapshot: Snapshot;
  onSaved: (snapshot: Snapshot) => void;
  onUnlock?: () => void;
}) {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [syncKey, setSyncKey] = useState('');
  const [rePair, setRePair] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    window.openpos
      .getConnection?.()
      .then((value) => {
        if (active) setConnection(value);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const clearSecret = () => setSyncKey('');
    window.addEventListener('openpos:locked', clearSecret);
    return () => window.removeEventListener('openpos:locked', clearSecret);
  }, []);
  const locked = Boolean(connection?.configured && !snapshot.session.isAdmin && !rePair);
  const patch = (value: Partial<Connection>) =>
    setConnection((current) => current && { ...current, ...value });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!connection || !window.openpos.saveConnection) return;
    setError('');
    if (!connection.deviceName.trim()) {
      setError('Enter a name for this phone or tablet.');
      return;
    }
    if (syncKey.length < 24) {
      setError('Enter the full connection key from the primary device (at least 24 characters).');
      return;
    }
    setBusy(true);
    try {
      const next = await window.openpos.saveConnection({
        deviceName: connection.deviceName.trim(),
        clientId: connection.clientId,
        serverUrl: connection.serverUrl.trim(),
        defaultTab: connection.defaultTab,
        syncKey,
        ...(rePair ? { rePair: true } : {})
      });
      setSyncKey('');
      onSaved(next);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="connection-form">
      <ErrorText error={error} />
      {notice && (
        <p className="success-notice" role="status">
          {notice}
        </p>
      )}
      {!connection ? (
        <p role="status">Loading this device’s connection…</p>
      ) : (
        <>
          <div className="connection-steps">
            <h3>Connect to your Windows primary device</h3>
            <ol>
              <li>Join your business’s trusted private Wi-Fi network.</li>
              <li>
                On Windows, set an administrator password in Configuration → Security. Then choose
                Primary (master) in This device.
              </li>
              <li>
                Register this client’s ID on Windows and save its configuration. Enter the primary
                device URL and connection key below.
              </li>
            </ol>
            <p>The Windows primary device must stay running. Changes require a live connection.</p>
          </div>
          <Field
            label="This client’s ID"
            hint="Register this ID in the primary device’s Registered clients list."
          >
            <div className="copy-field">
              <input value={connection.clientId} readOnly autoComplete="off" />
              <button
                className="icon-button"
                type="button"
                aria-label="Copy client ID"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connection.clientId);
                    setNotice('Client ID copied.');
                  } catch {
                    setError(
                      'Select the client ID and copy it using your device’s text selection menu.'
                    );
                  }
                }}
              >
                <I path={mdiContentCopy} />
              </button>
            </div>
          </Field>
          {locked && (
            <div className="notice">
              <p>
                Unlock administrator controls to change this connection. If the primary device is
                unavailable, re-pair using its full connection key.
              </p>
              {onUnlock && (
                <button
                  className="secondary"
                  type="button"
                  disabled={!snapshot.sync.connected}
                  onClick={onUnlock}
                >
                  <I path={mdiShieldLockOutline} size={0.8} /> Unlock administrator
                </button>
              )}
            </div>
          )}
          {connection.configured && !snapshot.session.isAdmin && (
            <label className="checkbox-field re-pair-choice">
              <input
                type="checkbox"
                checked={rePair}
                disabled={busy}
                onChange={(event) => {
                  setRePair(event.target.checked);
                  setSyncKey('');
                }}
              />
              <span>Re-pair this device using the full primary connection key</span>
            </label>
          )}
          {rePair && (
            <div className="notice">
              Re-pairing replaces this device’s connection and clears its current administrator
              session. It does not change any business data on the primary device.
            </div>
          )}
          <form onSubmit={submit}>
            <fieldset disabled={busy || locked} className="connection-fields">
              <div className="form-grid">
                <Field label="Device name">
                  <input
                    required
                    maxLength={80}
                    value={connection.deviceName}
                    onChange={(event) => patch({ deviceName: event.target.value })}
                    placeholder="Kitchen tablet"
                  />
                </Field>
                <Field label="Open on launch">
                  <select
                    value={connection.defaultTab}
                    onChange={(event) =>
                      patch({ defaultTab: event.target.value as Connection['defaultTab'] })
                    }
                  >
                    <option value="menu">Menu Items</option>
                    <option value="orders">Orders</option>
                  </select>
                </Field>
              </div>
              <Field
                label="Primary device URL"
                hint="Use a private network IPv4 address, for example http://192.168.1.10:3210."
              >
                <input
                  required
                  type="url"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="off"
                  value={connection.serverUrl}
                  onChange={(event) => patch({ serverUrl: event.target.value })}
                  placeholder="http://192.168.1.10:3210"
                />
              </Field>
              <Field
                label="Connection key"
                hint="Re-enter the full key from the Windows primary device whenever you save connection settings."
              >
                <input
                  required
                  type="password"
                  minLength={24}
                  maxLength={256}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={syncKey}
                  onChange={(event) => setSyncKey(event.target.value)}
                  placeholder="Enter the primary connection key"
                />
              </Field>
              <button className="primary connection-submit" type="submit">
                <I path={mdiWifi} size={0.85} />
                {busy
                  ? 'Connecting…'
                  : connection.configured
                    ? 'Save connection'
                    : 'Connect to primary device'}
              </button>
            </fieldset>
          </form>
          <p className="muted connection-footnote">
            Android joins an existing Windows workspace. It does not create a separate sales ledger.
            Keep the connection key private and use only a trusted business network.
          </p>
        </>
      )}
    </div>
  );
}
