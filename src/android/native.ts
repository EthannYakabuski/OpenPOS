import type { MobileConnection, MobileConnectionInput } from '../shared/types';

/** Native methods deliberately expose no filesystem access, URL fetch or secrets. */
export interface AndroidNativePort {
  getConnection(): Promise<MobileConnection>;
  saveConnection(connection: MobileConnectionInput): Promise<MobileConnection>;
  request(request: { route: string; body: string }): Promise<{ body: string }>;
  shareFile(file: { name: string; content: string; mime: string }): Promise<void>;
  printHtml(receipt: { html: string }): Promise<void>;
  openHelp(): Promise<void>;
}
