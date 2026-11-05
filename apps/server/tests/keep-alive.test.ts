import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { holdIdleSockets, KEEP_ALIVE_MS } from '../keep-alive.ts';

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

describe('idle keep-alive sockets', () => {
  it('outlive the 90 s idle timeout of tailscale serve and cloudflared', () => {
    expect(KEEP_ALIVE_MS).toBeGreaterThan(90_000);
  });

  it('are held that long, and the server says so', async () => {
    server = createServer((_, res) => res.end('ok'));
    holdIdleSockets(server);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_MS);
    expect(server.headersTimeout).toBeGreaterThan(KEEP_ALIVE_MS);
    expect(server.headersTimeout).toBeLessThanOrEqual(server.requestTimeout);
    await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done));
    const { port } = server.address() as AddressInfo;
    const header = await new Promise<string | string[] | undefined>((done, fail) => {
      const req = request({ host: '127.0.0.1', port, headers: { connection: 'keep-alive' } }, (res) => {
        res.resume();
        done(res.headers['keep-alive']);
      });
      req.on('error', fail);
      req.end();
    });
    expect(header).toBe(`timeout=${KEEP_ALIVE_MS / 1000}`);
  });
});
