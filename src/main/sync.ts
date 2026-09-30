import http, { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DeviceConfig } from '../shared/types';

const MAX_REQUEST = 2 * 1024 * 1024;
const MAX_RESPONSE = 64 * 1024 * 1024;
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function hmac(key: string, value: string) {
  return createHmac('sha256', key).update(value).digest('hex');
}
function safeEqual(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function requestSignature(
  key: string,
  method: string,
  route: string,
  stamp: string,
  nonce: string,
  body: string
) {
  return hmac(key, [method, route, stamp, nonce, digest(body)].join('\n'));
}
function responseSignature(key: string, nonce: string, status: number, body: string) {
  return hmac(key, [nonce, status, digest(body)].join('\n'));
}
async function readBody(message: IncomingMessage, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of message) {
    bytes += chunk.length;
    if (bytes > max) throw new Error('The network request is too large.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export interface RemoteContext {
  clientId: string;
}
export class SyncServer {
  private server?: Server;
  private nonces = new Map<string, number>();
  constructor(
    private readonly device: DeviceConfig,
    private readonly handler: (route: string, body: any, context: RemoteContext) => Promise<unknown>
  ) {}
  async start(): Promise<void> {
    const server = http.createServer((request, response) => {
      void this.serve(request, response);
    });
    this.server = server;
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.maxHeadersCount = 30;
    server.keepAliveTimeout = 2000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.device.port, '0.0.0.0', () => {
        server.removeListener('error', reject);
        server.on('error', () => {});
        resolve();
      });
    });
  }
  private async serve(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    const clientId = String(request.headers['x-openpos-client'] || ''),
      stamp = String(request.headers['x-openpos-time'] || ''),
      nonce = String(request.headers['x-openpos-nonce'] || ''),
      signature = String(request.headers['x-openpos-signature'] || '');
    let authenticated = false;
    const send = (status: number, value: unknown) => {
      if (response.destroyed) return;
      const body = JSON.stringify(value);
      response.statusCode = status;
      if (authenticated)
        response.setHeader(
          'X-OpenPOS-Signature',
          responseSignature(this.device.syncKey, nonce, status, body)
        );
      response.end(body);
    };
    try {
      if (request.method !== 'POST' || !request.url?.startsWith('/v1/') || request.headers.origin) {
        send(403, { error: 'Connection not permitted.' });
        return;
      }
      if (
        !this.device.registeredClients.some((c) => c.id === clientId) ||
        !/^\d{13}$/.test(stamp) ||
        Math.abs(Date.now() - Number(stamp)) > 60000 ||
        !/^[a-zA-Z0-9-]{20,100}$/.test(nonce)
      ) {
        send(401, {
          error:
            'Device authentication failed. Check registration, sync key and both device clocks.'
        });
        return;
      }
      const raw = await readBody(request, MAX_REQUEST);
      if (
        !safeEqual(
          signature,
          requestSignature(this.device.syncKey, request.method, request.url, stamp, nonce, raw)
        )
      ) {
        send(401, { error: 'Device authentication failed. Check the sync key.' });
        return;
      }
      authenticated = true;
      for (const [key, expires] of this.nonces) if (expires < Date.now()) this.nonces.delete(key);
      if (this.nonces.has(nonce)) {
        send(409, { error: 'This network request has already been received.' });
        return;
      }
      if (this.nonces.size > 100000) {
        send(429, { error: 'The master is receiving too many requests.' });
        return;
      }
      this.nonces.set(nonce, Date.now() + 120000);
      const body = raw ? JSON.parse(raw) : {};
      send(200, await this.handler(request.url, body, { clientId }));
    } catch (error: any) {
      send(400, {
        error: error instanceof Error ? error.message : 'The request could not be completed.'
      });
    }
  }
  async close() {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

export class SyncClient {
  private interval?: ReturnType<typeof setInterval>;
  private polling = false;
  private stopped = false;
  constructor(
    private readonly device: DeviceConfig,
    private readonly onSnapshot: (value: any) => Promise<void>,
    private readonly onError: (error: Error) => void,
    private readonly pollContext: () => unknown = () => ({})
  ) {}
  async request<T = any>(route: string, value: unknown): Promise<T> {
    if (this.stopped) throw new Error('Client connection has stopped.');
    const url = new URL(route, this.device.serverUrl),
      body = JSON.stringify(value),
      stamp = String(Date.now()),
      nonce = randomUUID();
    if (Buffer.byteLength(body) > MAX_REQUEST)
      throw new Error('This change is too large to send to the master.');
    return new Promise<T>((resolve, reject) => {
      const request = http.request(
        url,
        {
          method: 'POST',
          timeout: 4500,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-OpenPOS-Client': this.device.clientId,
            'X-OpenPOS-Time': stamp,
            'X-OpenPOS-Nonce': nonce,
            'X-OpenPOS-Signature': requestSignature(
              this.device.syncKey,
              'POST',
              route,
              stamp,
              nonce,
              body
            )
          }
        },
        (response) => {
          void (async () => {
            try {
              const result = await readBody(response, MAX_RESPONSE);
              if (
                !safeEqual(
                  String(response.headers['x-openpos-signature'] || ''),
                  responseSignature(this.device.syncKey, nonce, response.statusCode || 500, result)
                )
              )
                throw new Error(
                  'Master authentication failed. Check the shared sync key, registration and device clocks.'
                );
              const parsed = JSON.parse(result);
              if (response.statusCode !== 200)
                throw new Error(parsed.error || 'The master rejected the change.');
              resolve(parsed as T);
            } catch (error) {
              reject(error);
            }
          })();
        }
      );
      request.on('timeout', () =>
        request.destroy(
          new Error('The master did not respond. Changes are disabled until it reconnects.')
        )
      );
      request.on('error', reject);
      request.end(body);
    });
  }
  async poll() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    try {
      const result = await this.request('/v1/snapshot', this.pollContext());
      if (!this.stopped) await this.onSnapshot(result);
    } catch (error) {
      if (!this.stopped) this.onError(error as Error);
    } finally {
      this.polling = false;
    }
  }
  async start() {
    await this.poll();
    if (!this.stopped)
      this.interval = setInterval(() => {
        void this.poll();
      }, 1000);
  }
  close() {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
  }
}
