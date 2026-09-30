import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { OpenPOSService } from './service';
import { receiptHtml } from './receipt';
import { auditCSV } from './export';

const dataPath = path.resolve(process.env.OPENPOS_DATA_DIR || path.join(os.homedir(), '.openpos'));
if (process.env.OPENPOS_DATA_DIR) app.setPath('userData', path.join(dataPath, 'runtime'));
let window: BrowserWindow | undefined;
let service: OpenPOSService | undefined;
let shutdown = false;

function logError(error: unknown) {
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: error instanceof Error ? error.message : String(error)
  });
  console.error(entry);
  void fs
    .mkdir(path.join(dataPath, 'logs'), { recursive: true })
    .then(() => fs.appendFile(path.join(dataPath, 'logs', 'application.ndjson'), `${entry}\n`))
    .catch(() => {});
}

function registerIPC() {
  const handle = (channel: string, handler: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, ...args: any[]) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Untrusted application window.');
      return handler(...args);
    });
  handle('pos:snapshot', () => service!.getSnapshot());
  handle('pos:execute', (command) => service!.execute(command));
  handle('pos:unlock', (password) => service!.unlock(password));
  handle('pos:lock', () => service!.lock());
  handle('pos:password', (password, currentPassword) =>
    service!.setPassword(password, currentPassword)
  );
  handle('pos:device', (device) => service!.saveDevice(device));
  handle('pos:audit', (from, to) => service!.getAudit(from, to));
  handle('pos:backup', () => service!.backup());
  handle('pos:data-folder', async () => {
    const snapshot = await service!.getSnapshot();
    if (!snapshot.session.isAdmin) throw new Error('Unlock administration in Configuration first.');
    const error = await shell.openPath(dataPath);
    if (error) throw new Error(error);
  });
  handle('pos:help', async () => {
    const folder = path.join(dataPath, 'help');
    await fs.mkdir(folder, { recursive: true });
    for (const file of ['help.html', 'style.css'])
      await fs.copyFile(path.join(__dirname, '../help', file), path.join(folder, file));
    await shell.openExternal(pathToFileURL(path.join(folder, 'help.html')).href);
  });
  handle('pos:print', async (id) => {
    if (typeof id !== 'string') throw new Error('Choose an order to print.');
    const snapshot = await service!.getSnapshot();
    const order = snapshot.state.orders.find((candidate) => candidate.id === id);
    if (!order) throw new Error('Order not found.');
    const receipt = new BrowserWindow({
      show: false,
      width: 480,
      height: 720,
      parent: window,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    receipt.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    try {
      await receipt.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(order, snapshot.state.config))}`
      );
      await new Promise<void>((resolve, reject) =>
        receipt.webContents.print({ silent: false, printBackground: false }, (success, failure) => {
          if (success || /cancel/i.test(failure)) resolve();
          else reject(new Error(failure || 'Printer could not complete the receipt.'));
        })
      );
    } finally {
      receipt.destroy();
    }
  });
  handle('pos:export-audit', async (from, to) => {
    const report = await service!.getAudit(from, to);
    const destination = await dialog.showSaveDialog(window!, {
      title: 'Export sales report',
      defaultPath: `OpenPOS-sales-${from}-${to}.csv`,
      filters: [{ name: 'CSV spreadsheet', extensions: ['csv'] }]
    });
    if (destination.canceled || !destination.filePath) return null;
    await fs.writeFile(destination.filePath, auditCSV(report), 'utf8');
    return destination.filePath;
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#f6f7f2',
    title: 'OpenPOS',
    icon: path.join(__dirname, '../assets/icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback) =>
    callback(contents === window?.webContents && permission === 'clipboard-sanitized-write')
  );
  if (!app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.control && input.key.toLowerCase() === 'r') {
        event.preventDefault();
        window?.webContents.reload();
      }
    });
  }
  window.once('ready-to-show', () => window?.show());
  window.webContents.on('render-process-gone', (_event, details) =>
    logError(`Renderer stopped: ${details.reason}`)
  );
  await window.loadFile(path.join(__dirname, '../renderer/index.html'));
  window.on('closed', () => {
    window = undefined;
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      service = new OpenPOSService(dataPath);
      await service.init();
      registerIPC();
      service.onChange((snapshot) => {
        if (window && !window.isDestroyed()) window.webContents.send('pos:changed', snapshot);
      });
      await createWindow();
    })
    .catch((error) => {
      logError(error);
      dialog.showErrorBox(
        'OpenPOS could not start',
        `${error instanceof Error ? error.message : error}\n\nData folder: ${dataPath}\nYour existing files have been preserved.`
      );
      app.exit(1);
    });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (shutdown) return;
    event.preventDefault();
    shutdown = true;
    Promise.resolve(service?.close())
      .catch(logError)
      .finally(() => app.quit());
  });
}
process.on('uncaughtException', logError);
process.on('unhandledRejection', logError);
