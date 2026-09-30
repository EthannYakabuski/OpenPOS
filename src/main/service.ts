import { promises as fs } from 'node:fs';
import { hostname } from 'node:os';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type {
  AuditReport,
  BusinessState,
  Command,
  DeviceConfig,
  Snapshot,
  SyncStatus
} from '../shared/types';
import { adminCommand, applyCommand, audit } from '../core/domain';
import {
  assert,
  array,
  object,
  text,
  validateDevice,
  validateMenuItem,
  validateState
} from '../core/validation';
import { atomicJSON, DataSizeError, exists, JSONStore, readJSON } from '../core/storage';
import { SyncClient, SyncServer } from './sync';

const scrypt = promisify(scryptCallback);
interface Auth {
  installationId: string;
  salt?: string;
  hash?: string;
}
interface RemoteSnapshot {
  state: BusinessState;
  passwordSet: boolean;
  authorityId: string;
  serverEpoch: string;
  serverUrl?: string;
  adminValid?: boolean;
}
interface AdminToken {
  clientId: string;
  expires: number;
}
export class OpenPOSService {
  private readonly store: JSONStore;
  private state!: BusinessState;
  private device!: DeviceConfig;
  private auth!: Auth;
  private admin = false;
  private remoteAdmin = '';
  private remotePasswordSet = false;
  private remoteState?: BusinessState;
  private remoteAuthority = '';
  private remoteEpoch = '';
  private readonly serverEpoch = randomUUID();
  private sync: SyncStatus = { connected: true, message: 'Standalone · stored on this device' };
  private warning?: string;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private server?: SyncServer;
  private client?: SyncClient;
  private tokens = new Map<string, AdminToken>();
  private failures = new Map<string, { attempts: number; until: number }>();
  private closed = false;
  private faulted = false;
  private lockOwned = false;
  private pairingPending = false;
  private lastEmittedAt = 0;
  private cacheDirty = false;
  private lastCacheAttempt = 0;
  constructor(readonly dataPath: string) {
    this.store = new JSONStore(dataPath);
  }
  async init(): Promise<void> {
    await fs.mkdir(this.dataPath, { recursive: true });
    await this.acquireLock();
    try {
      this.state = await this.store.init();
      this.auth = (await exists(this.store.file('auth.json')))
        ? await readJSON<Auth>(this.store.file('auth.json'))
        : { installationId: randomUUID() };
      assert(
        typeof this.auth.installationId === 'string' &&
          (!this.auth.hash ||
            (/^[0-9a-f]{128}$/.test(this.auth.hash) &&
              /^[0-9a-f]{32}$/.test(this.auth.salt || ''))),
        'auth.json is invalid. Restore its backup or contact your administrator.'
      );
      if (!(await exists(this.store.file('auth.json'))))
        await atomicJSON(this.store.file('auth.json'), this.auth);
      this.device = (await exists(this.store.file('device.json')))
        ? await readJSON<DeviceConfig>(this.store.file('device.json'))
        : {
            deviceName: hostname(),
            role: 'standalone',
            defaultTab: 'menu',
            serverUrl: '',
            port: 3210,
            syncKey: randomBytes(24).toString('hex'),
            clientId: randomUUID(),
            registeredClients: []
          };
      validateDevice(this.device);
      await atomicJSON(this.store.file('device.json'), this.device);
      this.admin = !this.auth.hash;
      if (await exists(this.store.file('client-cache.json'))) {
        try {
          const cached = await readJSON<RemoteSnapshot>(this.store.file('client-cache.json'));
          validateState(cached.state);
          if (cached.serverUrl === this.device.serverUrl) {
            this.remoteState = cached.state;
            this.remoteAuthority = cached.authorityId;
            this.remoteEpoch = cached.serverEpoch;
            this.remotePasswordSet = cached.passwordSet;
          }
        } catch {
          this.warning =
            'The local client cache is invalid; reconnect to the master to rebuild it.';
        }
      }
      this.store.watchMenu(
        (_menu) =>
          this.serial(async () => {
            assert(
              this.device.role !== 'client',
              'Edit menu.json on the master. Client files never upload to the master.'
            );
            const menu = await readJSON<unknown>(this.store.file('menu.json'));
            array(menu, 'Menu');
            menu.forEach(validateMenuItem);
            const next = {
              ...structuredClone(this.state),
              menu,
              revision: this.state.revision + 1
            };
            validateState(next);
            await this.commit(next, 'manual-menu-edit');
            this.warning = undefined;
            this.emit();
          }),
        (error) => {
          this.warning = `Menu file was not applied: ${error.message}`;
          this.emit();
        }
      );
      await this.configureSync();
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  private async acquireLock(): Promise<void> {
    const file = this.store.file('instance.lock');
    try {
      const handle = await fs.open(file, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })
      );
      await handle.close();
      this.lockOwned = true;
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      let pid = 0;
      try {
        pid = (await readJSON<{ pid: number }>(file)).pid;
      } catch {
        throw new Error(
          'The data folder has an unreadable instance.lock. Confirm OpenPOS is closed before removing that lock file.'
        );
      }
      let alive = true;
      try {
        process.kill(pid, 0);
      } catch (e: any) {
        if (e.code === 'ESRCH') alive = false;
      }
      if (alive)
        throw new Error(
          'This data folder is already open in another OpenPOS process. Close it before continuing.'
        );
      await fs.unlink(file);
      return this.acquireLock();
    }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      assert(!this.closed, 'OpenPOS is closing.');
      assert(
        !this.faulted,
        'A data write failed. Restart OpenPOS to recover its saved transaction before making more changes.'
      );
      return work();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private async commit(next: BusinessState, type: string) {
    try {
      await this.store.commit(next, type);
      this.state = next;
    } catch (error) {
      if (error instanceof DataSizeError) {
        this.warning = error.message;
        this.emit();
        throw error;
      }
      this.faulted = true;
      this.warning =
        'A data write failed. Restart OpenPOS to recover the transaction; further changes are disabled.';
      this.emit();
      throw error;
    }
  }
  getSnapshot(): Snapshot {
    const isClient = this.device.role === 'client';
    const state = isClient
      ? this.remoteState || {
          ...this.state,
          revision: 0,
          menu: [],
          inventory: [],
          orders: [],
          movements: []
        }
      : this.state;
    return structuredClone({
      state,
      device: this.device,
      session: {
        isAdmin: this.admin,
        passwordSet: isClient ? this.remotePasswordSet : Boolean(this.auth.hash)
      },
      sync: this.sync,
      dataPath: this.dataPath,
      ...(this.warning ? { warning: this.warning } : {})
    });
  }
  onChange(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit() {
    if (!this.state || !this.device || this.closed) return;
    this.lastEmittedAt = Date.now();
    if (!this.listeners.size) return;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* A renderer callback cannot abort persisted business changes. */
      }
    }
  }
  async execute(command: Command): Promise<Snapshot> {
    if (this.device.role === 'client') {
      assert(
        this.sync.connected && this.client && this.remoteState,
        'The master is offline. Reconnect before making changes.'
      );
      try {
        const result = await this.client.request<RemoteSnapshot>('/v1/execute', {
          command,
          adminToken: this.remoteAdmin,
          serverEpoch: this.remoteEpoch
        });
        await this.acceptRemote(result);
        return this.getSnapshot();
      } catch (error) {
        await this.client.poll();
        throw error;
      }
    }
    return this.serial(async () => {
      await this.executeLocal(command, this.admin);
      return this.getSnapshot();
    });
  }
  private async executeLocal(command: Command, authorized: boolean) {
    object(command, 'Command');
    if (adminCommand(command) || command.type === 'start-fresh')
      assert(authorized, 'Unlock administrator controls before making this change.');
    if (command.type === 'start-fresh') {
      assert(
        command.confirmation === 'START FRESH',
        'Type START FRESH to confirm clearing the trading history and stock counts.'
      );
      assert(
        command.expectedRevision === this.state.revision,
        'Data changed. Review the latest totals and confirm again.'
      );
      const backup = await this.store.backup(this.state);
      const next = structuredClone(this.state);
      next.revision++;
      next.orders = [];
      next.movements = [];
      for (const i of next.inventory) {
        i.quantity = 0;
        i.updatedAt = new Date().toISOString();
      }
      await this.commit(next, 'start-fresh');
      this.warning = `Started fresh. A complete business backup was saved to ${backup}`;
    } else {
      const next = applyCommand(this.state, command);
      if (next !== this.state) await this.commit(next, command.type);
    }
    this.emit();
  }
  private async verify(password: string, identity = 'local') {
    text(password, 'Password', 256);
    const failed = this.failures.get(identity);
    assert(
      !failed || failed.until <= Date.now(),
      'Too many password attempts. Wait one minute and try again.'
    );
    if (!this.auth.hash) return true;
    const hash = (await scrypt(password, this.auth.salt!, 64)) as Buffer;
    const matches = timingSafeEqual(hash, Buffer.from(this.auth.hash, 'hex'));
    if (matches) {
      this.failures.delete(identity);
      return true;
    }
    const attempts = (failed?.attempts || 0) + 1;
    this.failures.set(identity, { attempts, until: attempts >= 5 ? Date.now() + 60000 : 0 });
    return false;
  }
  async unlock(password: string): Promise<Snapshot> {
    if (this.device.role === 'client') {
      if (!this.sync.connected || !this.client) {
        assert(
          await this.verify(password),
          'Enter this installation’s local administrator password to repair its connection.'
        );
        this.admin = true;
      } else {
        const result = await this.client.request<{ token: string }>('/v1/unlock', { password });
        this.remoteAdmin = result.token;
        this.admin = true;
      }
    } else {
      assert(await this.verify(password), 'The administrator password is incorrect.');
      this.admin = true;
    }
    this.emit();
    return this.getSnapshot();
  }
  async lock(): Promise<Snapshot> {
    this.admin = false;
    const token = this.remoteAdmin;
    this.remoteAdmin = '';
    if (token && this.client && this.sync.connected)
      await this.client.request('/v1/lock', { adminToken: token }).catch(() => {});
    this.emit();
    return this.getSnapshot();
  }
  async setPassword(password: string, currentPassword?: string): Promise<Snapshot> {
    if (this.device.role === 'client') {
      assert(
        this.client && this.sync.connected,
        'Reconnect to the master before changing its password.'
      );
      await this.client.request('/v1/password', {
        password,
        currentPassword,
        adminToken: this.remoteAdmin
      });
      this.remoteAdmin = '';
      this.admin = false;
      await this.client.poll();
      return this.getSnapshot();
    }
    return this.serial(async () => {
      await this.setLocalPassword(password, currentPassword);
      this.admin = true;
      this.emit();
      return this.getSnapshot();
    });
  }
  private async setLocalPassword(password: string, currentPassword?: string) {
    text(password, 'Password', 256, false);
    assert(password.length >= 8, 'Use an administrator password of at least eight characters.');
    if (this.auth.hash)
      assert(
        await this.verify(currentPassword || ''),
        'Enter the current administrator password to change it.'
      );
    else assert(this.device.role !== 'client', 'Set the initial password on the master.');
    const salt = randomBytes(16).toString('hex'),
      hash = ((await scrypt(password, salt, 64)) as Buffer).toString('hex');
    const next = { ...this.auth, salt, hash };
    await atomicJSON(this.store.file('auth.json'), next);
    this.auth = next;
    this.tokens.clear();
  }
  async saveDevice(device: DeviceConfig): Promise<Snapshot> {
    return this.serial(async () => {
      assert(this.admin, 'Unlock administrator controls to change this device.');
      validateDevice(device);
      if (device.role === 'master')
        assert(
          this.auth.hash,
          'Set this installation’s administrator password before enabling master mode.'
        );
      // Local authority data is kept separate from downloaded client data, so pairing never uploads demo records.
      const old = this.device;
      await this.stopSync();
      this.device = structuredClone(device);
      this.remoteAdmin = '';
      this.tokens.clear();
      if (old.serverUrl !== device.serverUrl || old.syncKey !== device.syncKey) {
        this.remoteState = undefined;
        this.remoteAuthority = '';
        this.remoteEpoch = '';
      }
      try {
        await atomicJSON(this.store.file('device.json'), this.device);
      } catch (error) {
        this.device = old;
        await this.configureSync();
        throw error;
      }
      await this.configureSync();
      this.emit();
      return this.getSnapshot();
    });
  }
  async getAudit(from: string, to: string): Promise<AuditReport> {
    assert(this.admin, 'Unlock administrator controls to view sales reports.');
    if (this.device.role === 'client') {
      assert(this.sync.connected && this.client, 'Reconnect to the master to view sales reports.');
      return this.client.request<AuditReport>('/v1/audit', {
        from,
        to,
        adminToken: this.remoteAdmin
      });
    }
    return audit(this.state, from, to);
  }
  async backup(): Promise<string> {
    assert(this.admin, 'Unlock administrator controls to create a backup.');
    return this.store.backup(this.getSnapshot().state);
  }
  private remoteSnapshot(): RemoteSnapshot {
    return {
      state: this.state,
      authorityId: this.auth.installationId,
      serverEpoch: this.serverEpoch,
      passwordSet: Boolean(this.auth.hash)
    };
  }
  private authorizedToken(token: unknown, clientId: string): boolean {
    const record = typeof token === 'string' ? this.tokens.get(token) : undefined;
    if (!record || record.clientId !== clientId || record.expires < Date.now()) return false;
    return true;
  }
  private async configureSync() {
    if (this.device.role === 'standalone') {
      this.sync = { connected: true, message: 'Standalone · stored on this device' };
      return;
    }
    if (this.device.role === 'master') {
      if (!this.auth.hash) {
        this.sync = {
          connected: false,
          message: 'Set an administrator password before enabling the master server.'
        };
        return;
      }
      this.server = new SyncServer(this.device, (route, body, context) =>
        this.serial(async () => {
          object(body, 'Network request');
          const authorized = this.authorizedToken(body.adminToken, context.clientId);
          switch (route) {
            case '/v1/snapshot':
              return body.revision === this.state.revision &&
                body.authorityId === this.auth.installationId &&
                body.serverEpoch === this.serverEpoch
                ? {
                    unchanged: true,
                    revision: this.state.revision,
                    authorityId: this.auth.installationId,
                    serverEpoch: this.serverEpoch,
                    passwordSet: Boolean(this.auth.hash),
                    adminValid: authorized
                  }
                : { ...this.remoteSnapshot(), adminValid: authorized };
            case '/v1/execute':
              assert(
                body.serverEpoch === this.serverEpoch,
                'The master restarted. Refresh the connection before retrying your change.'
              );
              await this.executeLocal(body.command, authorized);
              return { ...this.remoteSnapshot(), adminValid: authorized };
            case '/v1/unlock': {
              assert(this.auth.hash, 'Set the administrator password on the master first.');
              assert(
                await this.verify(body.password, context.clientId),
                'The administrator password is incorrect.'
              );
              const token = randomBytes(32).toString('hex');
              for (const [key, record] of this.tokens)
                if (record.expires < Date.now() || record.clientId === context.clientId)
                  this.tokens.delete(key);
              this.tokens.set(token, {
                clientId: context.clientId,
                expires: Date.now() + 8 * 60 * 60000
              });
              return { token };
            }
            case '/v1/lock':
              if (authorized) this.tokens.delete(body.adminToken);
              return { locked: true };
            case '/v1/password':
              assert(authorized, 'Unlock administrator controls before changing the password.');
              await this.setLocalPassword(body.password, body.currentPassword);
              return { passwordSet: true };
            case '/v1/audit':
              assert(authorized, 'Unlock administrator controls to view sales reports.');
              return audit(this.state, body.from, body.to);
            default:
              throw new Error('This network operation is not supported.');
          }
        })
      );
      try {
        await this.server.start();
        this.sync = { connected: true, message: `Master · listening on port ${this.device.port}` };
      } catch (error: any) {
        this.sync = { connected: false, message: `Master could not listen: ${error.message}` };
      }
      return;
    }
    this.pairingPending = true;
    this.sync = { connected: false, message: 'Connecting to master…' };
    this.client = new SyncClient(
      this.device,
      (result) => this.acceptRemote(result),
      (error) => {
        this.sync = {
          connected: false,
          message: `Offline · ${error.message}`,
          lastSync: this.sync.lastSync
        };
        this.emit();
      },
      () => ({
        revision: this.remoteState?.revision,
        authorityId: this.remoteAuthority,
        serverEpoch: this.remoteEpoch,
        adminToken: this.remoteAdmin
      })
    );
    await this.client.start();
  }
  private async acceptRemote(
    value: RemoteSnapshot | (Omit<RemoteSnapshot, 'state'> & { unchanged: true; revision: number })
  ) {
    object(value, 'Master snapshot');
    text(value.authorityId, 'Master identity', 100, false);
    assert(
      value.authorityId !== this.auth.installationId,
      'This installation cannot connect to itself as a client.'
    );
    const wasConnected = this.sync.connected,
      wasAdmin = this.admin,
      hadPassword = this.remotePasswordSet;
    if (this.pairingPending) {
      this.admin = false;
      this.pairingPending = false;
    }
    if (this.remoteAdmin && value.adminValid === false) {
      this.remoteAdmin = '';
      this.admin = false;
    }
    this.sync = {
      connected: true,
      message: 'Connected to master · changes synchronized',
      lastSync: new Date().toISOString()
    };
    if ('unchanged' in value) {
      assert(
        this.remoteState &&
          value.authorityId === this.remoteAuthority &&
          value.serverEpoch === this.remoteEpoch &&
          value.revision === this.remoteState.revision,
        'The master sent an invalid data revision.'
      );
      this.remotePasswordSet = value.passwordSet;
      if (this.cacheDirty && Date.now() - this.lastCacheAttempt >= 5000)
        await this.persistRemoteCache();
      if (
        !wasConnected ||
        wasAdmin !== this.admin ||
        hadPassword !== this.remotePasswordSet ||
        Date.now() - this.lastEmittedAt >= 30000
      )
        this.emit();
      return;
    }
    validateState(value.state);
    // Ignore out-of-order HTTP replies from the same authority.
    if (
      value.authorityId === this.remoteAuthority &&
      value.serverEpoch === this.remoteEpoch &&
      this.remoteState &&
      value.state.revision < this.remoteState.revision
    )
      return;
    const changed =
      !this.remoteState ||
      value.authorityId !== this.remoteAuthority ||
      this.remoteState.revision !== value.state.revision;
    this.remoteState = value.state;
    this.remoteAuthority = value.authorityId;
    this.remoteEpoch = value.serverEpoch;
    this.remotePasswordSet = value.passwordSet;
    this.sync = {
      connected: true,
      message: 'Connected to master · changes synchronized',
      lastSync: new Date().toISOString()
    };
    if (changed) {
      this.cacheDirty = true;
      await this.persistRemoteCache();
    }
    this.emit();
  }
  private async persistRemoteCache() {
    this.lastCacheAttempt = Date.now();
    try {
      await atomicJSON(this.store.file('client-cache.json'), {
        state: this.remoteState,
        authorityId: this.remoteAuthority,
        serverEpoch: this.remoteEpoch,
        passwordSet: this.remotePasswordSet,
        serverUrl: this.device.serverUrl
      });
      this.cacheDirty = false;
      if (this.warning?.startsWith('Offline cache could not be updated.')) {
        this.warning = undefined;
        this.emit();
      }
    } catch (error) {
      this.cacheDirty = true;
      this.warning = `Offline cache could not be updated. Your changes are saved on the master; keep this device connected. ${error instanceof Error ? error.message : ''}`;
      this.emit();
    }
  }
  private async stopSync() {
    this.client?.close();
    this.client = undefined;
    await this.server?.close();
    this.server = undefined;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.store.close();
    await this.stopSync();
    await this.queue;
    if (this.lockOwned) {
      await fs.unlink(this.store.file('instance.lock')).catch(() => {});
      this.lockOwned = false;
    }
    this.listeners.clear();
  }
}
