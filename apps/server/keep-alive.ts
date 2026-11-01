import type { Server } from 'node:http';

// tailscale serve and cloudflared (Omni Connect) are Go reverse proxies. They keep an idle connection to the server for
// up to 90 s and ignore the `Keep-Alive: timeout=` hint. Node closes an idle socket after 5 s (plus a 1 s buffer), so a
// request a proxy sends about 6 s after the last one can land on a socket Node is closing. Go never retries a POST, and
// the client gets an empty 502. The Google sign-in poll runs every 5 s, and a background tab's timers slip to 6 s.
// Holding idle sockets longer than the proxies do means the proxy always closes first.

/** Longer than the 90 s idle timeout tailscale serve and cloudflared use. */
export const KEEP_ALIVE_MS = 100_000;

/** Holds idle keep-alive sockets for KEEP_ALIVE_MS. headersTimeout stays above it, below requestTimeout (300 s). */
export function holdIdleSockets(server: Server): void {
  server.keepAliveTimeout = KEEP_ALIVE_MS;
  server.headersTimeout = KEEP_ALIVE_MS + 5_000;
}
