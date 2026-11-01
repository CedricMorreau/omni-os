// /api/auth: pairing a browser, and the Mac app's check that the server on the port is this install's Omni.
// requestGuard has checked the token before any of these run, except GET /auth/proof and GET /auth/desktop-pair.
// desktop-pair is the Linux app's window: a loopback GET with no proxy, and the token never appears in the URL.
import { Hono, type Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { apiToken, cookieName, proofFor } from './api-token.ts';
import { desktopPairAllowed } from './request-guard.ts';

export const authApi = new Hono();

/** 200 when the request carried the token: the Web UI asks this to decide whether to show the pairing screen. */
authApi.get('/', (c) => c.json({ ok: true }));

/**
 * Called with `Authorization: Bearer <token>`: hands the browser the token as an HttpOnly, SameSite=Strict cookie
 * on /api, so page scripts never hold it and EventSource and <img> requests carry it.
 */
function pairCookie(c: Context) {
  const https = new URL(c.req.url).protocol === 'https:' || c.req.header('x-forwarded-proto') === 'https';
  setCookie(c, cookieName(), apiToken(), { path: '/api', httpOnly: true, sameSite: 'Strict', secure: https, maxAge: 400 * 24 * 3600 });
}

authApi.post('/pair', (c) => {
  pairCookie(c);
  return c.json({ ok: true });
});

/** The Linux app's first navigation. Sets the same cookie as /pair, then sends the window to the Web UI. */
authApi.get('/desktop-pair', (c) => {
  if (!desktopPairAllowed(c)) return c.json({ error: 'Forbidden: desktop pairing is only from this machine' }, 403);
  pairCookie(c);
  return c.redirect('/');
});

/** HMAC-SHA256 of `omni-proof:<port>:<nonce>` keyed with the token: proves this server, on this port, holds it, without revealing it. */
authApi.get('/proof', (c) => {
  const nonce = c.req.query('nonce') ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(nonce)) return c.json({ error: 'nonce: 32 to 128 hex characters' }, 400);
  return c.json({ proof: proofFor(nonce) });
});
