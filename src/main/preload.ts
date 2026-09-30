import { contextBridge, ipcRenderer } from 'electron';
import type { OpenPOSAPI, Snapshot } from '../shared/types';

const api: OpenPOSAPI = {
  getSnapshot: () => ipcRenderer.invoke('pos:snapshot'),
  execute: (command) => ipcRenderer.invoke('pos:execute', command),
  unlock: (password) => ipcRenderer.invoke('pos:unlock', password),
  lock: () => ipcRenderer.invoke('pos:lock'),
  setPassword: (password, currentPassword) =>
    ipcRenderer.invoke('pos:password', password, currentPassword),
  saveDevice: (device) => ipcRenderer.invoke('pos:device', device),
  getAudit: (from, to) => ipcRenderer.invoke('pos:audit', from, to),
  exportAudit: (from, to) => ipcRenderer.invoke('pos:export-audit', from, to),
  openHelp: () => ipcRenderer.invoke('pos:help'),
  openDataFolder: () => ipcRenderer.invoke('pos:data-folder'),
  printReceipt: (id) => ipcRenderer.invoke('pos:print', id),
  backup: () => ipcRenderer.invoke('pos:backup'),
  onChange: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => listener(snapshot);
    ipcRenderer.on('pos:changed', handler);
    return () => ipcRenderer.removeListener('pos:changed', handler);
  }
};
contextBridge.exposeInMainWorld('openpos', api);
