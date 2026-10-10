import type {
  AuditReport,
  BusinessState,
  Command,
  MobileConnection,
  MobileConnectionInput,
  OpenPOSAPI,
  Snapshot
} from '../shared/types';
import { assert, object, text, validateState } from '../core/validation';
import { receiptHtml } from '../shared/receipt';
import { auditCSV } from '../shared/export';
import type { AndroidNativePort } from './native';

const emptyState = (): BusinessState => ({
  schemaVersion: 1,
  revision: 0,
  menu: [],
  inventory: [],
  orders: [],
  movements: [],
  config: {
    businessName: 'Connect to your shop',
    currency: 'CAD',
    taxRate: 0,
    fees: [],
    autoCompleteOrders: false,
    inventoryEnabled: false,
    receiptFooter: ''
  }
});
const initialConnection = (): MobileConnection => ({
  deviceName: 'Android',
  clientId: '',
  serverUrl: '',
  defaultTab: 'menu',
  configured: false
});
const administrative = new Set(['save-menu', 'save-inventory', 'restock', 'save-config']);

/** Shared UI adapter. Business writes always go to the authenticated Windows master. */
export class AndroidClient implements OpenPOSAPI {
  readonly platform = 'android' as const;
  readonly capabilities = {
    print: true,
    exportAudit: true,
    backup: false,
    dataFolder: false,
    connectionSettings: true
  };
  private connection = initialConnection();
  private state = emptyState();
  private hasState = false;
  private authority = '';
  private epoch = '';
  private adminToken = '';
  private passwordSet = false;
  private connected = false;
  private message = 'Connect this device to your Windows master.';
  private lastSync?: string;
  private active = true;
  private closed = false;
  private generation = 0;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private queue: Promise<unknown> = Promise.resolve();
  private initialization?: Promise<void>;

  constructor(
    private readonly native: AndroidNativePort,
    private readonly pollMs = 1500
  ) {}

  private initialize(): Promise<void> {
    if (!this.initialization)
      this.initialization = (async () => {
        this.connection = await this.native.getConnection();
        await this.serial(() => this.refreshInternal());
        this.schedule();
      })().catch((error) => {
        this.initialization = undefined;
        throw error;
      });
    return this.initialization;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(() => {
      assert(!this.closed, 'The Android connection has closed. Reopen OpenPOS.');
      return work();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  private snapshot(): Snapshot {
    return structuredClone({
      state: this.state,
      device: {
        ...this.connection,
        role: 'client',
        port: 3210,
        syncKey: '',
        registeredClients: []
      },
      session: {
        isAdmin: Boolean(this.adminToken) && this.active && this.connected,
        passwordSet: this.passwordSet
      },
      sync: { connected: this.connected, message: this.message, lastSync: this.lastSync },
      dataPath: 'Business data is stored on your Windows master.'
    });
  }
  private emit() {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        /* UI callbacks cannot abort saved changes. */
      }
    }
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.active || this.closed || this.pollMs <= 0) return;
    this.timer = setTimeout(() => {
      void this.serial(() => this.refreshInternal())
        .finally(() => this.schedule())
        .catch(() => {});
    }, this.pollMs);
  }
  private ensureCurrent(generation: number) {
    assert(
      !this.closed && this.active && this.generation === generation,
      'The connection changed or OpenPOS entered the background. Reconnect and review the latest order before retrying.'
    );
  }
  private async request(route: string, body: unknown, generation = this.generation): Promise<any> {
    const result = await this.native.request({ route, body: JSON.stringify(body) });
    const parsed: unknown = JSON.parse(result.body);
    object(parsed, 'Master response');
    if (
      (this.closed || !this.active || this.generation !== generation) &&
      route === '/v1/unlock' &&
      typeof parsed.token === 'string'
    ) {
      void this.native
        .request({ route: '/v1/lock', body: JSON.stringify({ adminToken: parsed.token }) })
        .catch(() => {});
    }
    this.ensureCurrent(generation);
    return parsed;
  }
  private accept(value: any) {
    object(value, 'Master snapshot');
    text(value.authorityId, 'Master identity', 100, false);
    text(value.serverEpoch, 'Master session', 100, false);
    assert(
      typeof value.passwordSet === 'boolean' && typeof value.adminValid === 'boolean',
      'The master sent an invalid security state.'
    );
    if (value.unchanged === true) {
      assert(
        this.hasState &&
          value.authorityId === this.authority &&
          value.serverEpoch === this.epoch &&
          value.revision === this.state.revision,
        'The master sent an invalid data revision.'
      );
    } else {
      validateState(value.state);
      if (
        this.hasState &&
        value.authorityId === this.authority &&
        value.serverEpoch === this.epoch &&
        value.state.revision < this.state.revision
      )
        return;
      if (value.authorityId !== this.authority || value.serverEpoch !== this.epoch)
        this.adminToken = '';
      this.state = structuredClone(value.state);
      this.hasState = true;
      this.authority = value.authorityId;
      this.epoch = value.serverEpoch;
    }
    if (!value.adminValid) this.adminToken = '';
    this.passwordSet = value.passwordSet;
    this.connected = true;
    this.message = 'Connected to master · changes synchronized';
    this.lastSync = new Date().toISOString();
    this.emit();
  }
  private async refreshInternal(): Promise<void> {
    if (!this.active || !this.connection.configured) return;
    const generation = this.generation;
    try {
      const value = await this.request(
        '/v1/snapshot',
        {
          revision: this.hasState ? this.state.revision : undefined,
          authorityId: this.authority,
          serverEpoch: this.epoch,
          adminToken: this.adminToken
        },
        generation
      );
      this.accept(value);
    } catch (error) {
      if (generation !== this.generation || !this.active || this.closed) return;
      this.connected = false;
      this.adminToken = '';
      this.message = `Offline · ${error instanceof Error ? error.message : 'The master could not be reached.'}`;
      this.emit();
    }
  }
  private requireConnection() {
    assert(
      this.active && this.connected && this.hasState,
      'Reconnect to the Windows master before making changes. Nothing is queued while offline.'
    );
  }
  private requireAdmin() {
    this.requireConnection();
    assert(this.adminToken, 'Unlock administrator controls before making this change.');
  }
  async getSnapshot(): Promise<Snapshot> {
    await this.initialize();
    return this.snapshot();
  }
  async getConnection(): Promise<MobileConnection> {
    await this.initialize();
    return structuredClone(this.connection);
  }
  onChange(listener: (snapshot: Snapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async refresh(): Promise<Snapshot> {
    await this.initialize();
    return this.serial(async () => {
      await this.refreshInternal();
      return this.snapshot();
    });
  }
  async saveConnection(input: MobileConnectionInput): Promise<Snapshot> {
    await this.initialize();
    return this.serial(async () => {
      assert(this.active, 'Return to OpenPOS before changing its connection.');
      assert(
        input.clientId === this.connection.clientId,
        'This device’s registration ID cannot be changed.'
      );
      const hasKey = typeof input.syncKey === 'string' && input.syncKey.trim().length >= 24;
      if (!this.connection.configured)
        assert(hasKey, 'Enter the master sync key (at least 24 characters).');
      else if (!(this.connected && this.adminToken))
        assert(
          input.rePair === true && hasKey,
          'Reconnect and unlock administrator controls, or choose Re-pair and enter the master sync key.'
        );
      assert(hasKey, 'Re-enter the full master connection key to save connection settings.');
      const oldToken = this.adminToken;
      this.adminToken = '';
      this.emit();
      if (oldToken)
        await this.native
          .request({ route: '/v1/lock', body: JSON.stringify({ adminToken: oldToken }) })
          .catch(() => {});
      const next = await this.native.saveConnection(input);
      this.generation++;
      this.connection = next;
      this.adminToken = '';
      this.authority = '';
      this.epoch = '';
      this.state = emptyState();
      this.hasState = false;
      this.passwordSet = false;
      this.connected = false;
      this.lastSync = undefined;
      this.message = 'Connecting to master…';
      this.emit();
      await this.refreshInternal();
      return this.snapshot();
    });
  }
  async execute(command: Command): Promise<Snapshot> {
    await this.initialize();
    return this.serial(async () => {
      this.requireConnection();
      assert(command.type !== 'start-fresh', 'Start fresh is available on Windows only.');
      if (administrative.has(command.type)) this.requireAdmin();
      try {
        this.accept(
          await this.request('/v1/execute', {
            command,
            adminToken: this.adminToken,
            serverEpoch: this.epoch
          })
        );
        return this.snapshot();
      } catch (error) {
        // Never retry a write automatically: an interrupted reply may already have been committed.
        await this.refreshInternal();
        throw error;
      }
    });
  }
  async unlock(password: string): Promise<Snapshot> {
    await this.initialize();
    return this.serial(async () => {
      this.requireConnection();
      assert(this.passwordSet, 'Set the administrator password on the Windows master first.');
      const result = await this.request('/v1/unlock', { password });
      text(result.token, 'Administrator session', 128, false);
      this.adminToken = result.token;
      await this.refreshInternal();
      assert(
        this.connected && this.adminToken,
        'The administrator session expired. Reconnect and unlock again.'
      );
      return this.snapshot();
    });
  }
  async lock(): Promise<Snapshot> {
    await this.initialize();
    const token = this.adminToken;
    this.generation++;
    this.adminToken = '';
    this.emit();
    if (token)
      await this.serial(async () => {
        await this.native
          .request({ route: '/v1/lock', body: JSON.stringify({ adminToken: token }) })
          .catch(() => {});
      });
    return this.snapshot();
  }
  async setPassword(): Promise<Snapshot> {
    throw new Error('Manage administrator passwords on the Windows master.');
  }
  async getAudit(from: string, to: string): Promise<AuditReport> {
    await this.initialize();
    return this.serial(async () => {
      this.requireAdmin();
      return this.request('/v1/audit', { from, to, adminToken: this.adminToken });
    });
  }
  async exportAudit(from: string, to: string): Promise<string | null> {
    const report = await this.getAudit(from, to);
    this.requireAdmin();
    await this.native.shareFile({
      name: 'openpos-sales.csv',
      content: auditCSV(report),
      mime: 'text/csv'
    });
    return 'Android share sheet';
  }
  async printReceipt(id: string): Promise<void> {
    await this.initialize();
    const order = this.state.orders.find((value) => value.id === id);
    assert(order, 'This order is unavailable. Reconnect to the master.');
    await this.native.printHtml({ html: receiptHtml(order, this.state.config) });
  }
  async openHelp(): Promise<void> {
    await this.native.openHelp();
  }
  async saveDevice(): Promise<Snapshot> {
    throw new Error(
      'Use Connection to pair this Android client. Master settings are managed on Windows.'
    );
  }
  async openDataFolder(): Promise<void> {
    throw new Error('Business files are stored on the Windows master.');
  }
  async backup(): Promise<string | null> {
    throw new Error('Create business backups on the Windows master.');
  }

  /** Native lifecycle changes invalidate in-flight replies and discard administrator access. */
  setActive(active: boolean): void {
    if (this.closed || this.active === active) return;
    this.active = active;
    this.generation++;
    const token = this.adminToken;
    this.adminToken = '';
    this.connected = false;
    this.message = active ? 'Reconnecting to master…' : 'Paused · reopen OpenPOS to reconnect.';
    if (this.timer) clearTimeout(this.timer);
    this.emit();
    if (token)
      void this.native
        .request({ route: '/v1/lock', body: JSON.stringify({ adminToken: token }) })
        .catch(() => {});
    if (active)
      void this.initialize()
        .then(() => this.serial(() => this.refreshInternal()))
        .finally(() => this.schedule())
        .catch(() => {});
  }
  dispose(): void {
    this.setActive(false);
    this.closed = true;
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}
