import { promises as fs, watch, FSWatcher } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { BusinessState } from '../shared/types';
import { createDemo } from './demo';
import { validateState } from './validation';

export async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (e: any) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
export async function readJSON<T>(file: string): Promise<T> {
  const stat = await fs.stat(file);
  if (stat.size > 64 * 1024 * 1024)
    throw new Error(`${path.basename(file)} exceeds the 64 MB safety limit.`);
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}
export class DataSizeError extends Error {
  constructor() {
    super(
      'The business data has reached the 64 MB safety limit. Create a backup and start a fresh trading history before adding more records.'
    );
    this.name = 'DataSizeError';
  }
}
export async function atomicJSON(file: string, value: unknown, maxBytes = 64 * 1024 * 1024) {
  const serialized = JSON.stringify(value, null, 2) + '\n';
  if (Buffer.byteLength(serialized, 'utf8') > maxBytes) throw new DataSizeError();
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, file);
  } catch (e) {
    await fs.unlink(temp).catch(() => {});
    throw e;
  }
}
const partitions = ['menu', 'inventory', 'orders', 'movements', 'config'] as const;
interface Transaction {
  state: BusinessState;
  event: { id: string; type: string; createdAt: string; revision: number; detail?: unknown };
}

/** One authority serializes writes. A full-state journal is replayed after interruption. */
export class JSONStore {
  private watcher?: FSWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private lastMenu = '';
  private saved = new Map<string, string>();
  private rejectedMenu = false;
  constructor(readonly directory: string) {}
  file(name: string) {
    return path.join(this.directory, name);
  }
  async init(): Promise<BusinessState> {
    await fs.mkdir(this.directory, { recursive: true });
    if (await exists(this.file('transaction.json'))) {
      const transaction = await readJSON<Transaction>(this.file('transaction.json'));
      validateState(transaction.state);
      await this.finish(transaction);
    }
    const found = await Promise.all(partitions.map((p) => exists(this.file(`${p}.json`))));
    if (!found.some(Boolean)) {
      const demo = createDemo();
      await this.commit(demo, 'demo-created');
      return demo;
    }
    if (!found.every(Boolean) || !(await exists(this.file('metadata.json'))))
      throw new Error(
        `Business data is incomplete in ${this.directory}. Restore a complete backup; existing files have not been overwritten.`
      );
    const meta = await readJSON<Pick<BusinessState, 'schemaVersion' | 'revision'>>(
      this.file('metadata.json')
    );
    const state: any = { ...meta };
    for (const part of partitions) state[part] = await readJSON(this.file(`${part}.json`));
    validateState(state);
    this.lastMenu = JSON.stringify(state.menu);
    for (const part of partitions) this.saved.set(part, JSON.stringify(state[part]));
    return state;
  }
  async commit(state: BusinessState, type: string, detail?: unknown) {
    validateState(state);
    const transaction: Transaction = {
      state,
      event: {
        id: randomUUID(),
        type,
        createdAt: new Date().toISOString(),
        revision: state.revision,
        ...(detail ? { detail } : {})
      }
    };
    await atomicJSON(this.file('transaction.json'), transaction);
    await this.finish(transaction);
  }
  private async finish(transaction: Transaction) {
    for (const part of partitions) {
      const serialized = JSON.stringify(transaction.state[part]);
      if (this.saved.get(part) === serialized) continue;
      if (
        part === 'menu' &&
        transaction.event.type === 'manual-menu-edit' &&
        this.saved.has('menu')
      ) {
        this.saved.set(part, serialized);
        this.lastMenu = serialized;
        continue;
      } // The external file already holds the import; never overwrite a newer editor save.
      if (part === 'menu' && (await exists(this.file('menu.json')))) {
        const raw = await fs.readFile(this.file('menu.json'), 'utf8');
        let disk = '';
        try {
          disk = JSON.stringify(JSON.parse(raw.replace(/^\uFEFF/, '')));
        } catch {
          /* Preserve malformed external input before replacing it. */
        }
        if (disk !== this.lastMenu && disk !== serialized)
          await this.preserveMenu(raw, 'conflicting');
      }
      await atomicJSON(this.file(`${part}.json`), transaction.state[part]);
      this.saved.set(part, serialized);
      if (part === 'menu') this.lastMenu = serialized;
    }
    await atomicJSON(this.file('metadata.json'), {
      schemaVersion: 1,
      revision: transaction.state.revision
    });
    // Event IDs permit downstream de-duplication if the process stops between append and journal removal.
    await fs.appendFile(this.file('events.ndjson'), JSON.stringify(transaction.event) + '\n', {
      encoding: 'utf8',
      mode: 0o600
    });
    await fs.unlink(this.file('transaction.json'));
  }
  watchMenu(onMenu: (menu: unknown) => Promise<void>, onError: (error: Error) => void) {
    this.watcher = watch(this.directory, (_event, file) => {
      if (file?.toString() !== 'menu.json') return;
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(async () => {
        try {
          const menu = await readJSON(this.file('menu.json'));
          if (JSON.stringify(menu) === this.lastMenu && !this.rejectedMenu) return;
          await onMenu(menu);
          this.rejectedMenu = false;
        } catch (e) {
          this.rejectedMenu = true;
          try {
            await this.preserveMenu(await fs.readFile(this.file('menu.json'), 'utf8'), 'rejected');
          } catch {
            /* Preserve the original error when backup storage is unavailable. */
          }
          onError(e as Error);
        }
      }, 350);
    });
    this.watcher.on('error', onError);
  }
  private async preserveMenu(raw: string, kind: string) {
    const folder = this.file('backups');
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(
      path.join(folder, `${kind}-menu-${Date.now()}-${randomUUID().slice(0, 8)}.txt`),
      raw,
      { encoding: 'utf8', mode: 0o600 }
    );
  }
  async backup(state: BusinessState): Promise<string> {
    const folder = this.file('backups');
    await fs.mkdir(folder, { recursive: true });
    const filename = path.join(
      folder,
      `openpos-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`
    );
    await atomicJSON(filename, { ...state });
    return filename;
  }
  close() {
    this.watcher?.close();
    if (this.timer) clearTimeout(this.timer);
  }
}
