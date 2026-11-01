// The Omni sync relay, a Cloudflare Worker (docs/adr/0008-cloudflare-relay.md). Each Mac keeps its own SQLite; this
// only carries changes between them. One Durable Object per user holds that user's change log and machine tokens
// (store.ts) and the WebSockets that tell a machine another one pushed. Thread and session files live in R2 under
// "<user>/files/". Sign-in is Clerk (auth.ts): only the users on ALLOWED_USERS get a token.
import { DurableObject } from 'cloudflare:workers';
import { allowedUsers, newToken, RelayError, tokenUser, verifyIdToken } from './auth.ts';
import { objectPath, RelayStore } from './store.ts';

interface Env {
  RELAY: DurableObjectNamespace<Relay>;
  BUCKET: R2Bucket;
  CLERK_ISSUER?: string;
  CLERK_CLIENT_ID?: string;
  ALLOWED_USERS?: string;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function failed(err: unknown): Response {
  if (err instanceof RelayError) return json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return json({ error: (err as Error)?.message ?? 'relay error' }, 500);
}

/** The relay token from `Authorization: Bearer`, or from a WebSocket's protocols ("omni-relay, bearer.<token>"): a WebSocket cannot set headers. */
function bearer(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  for (const p of (req.headers.get('sec-websocket-protocol') ?? '').split(',')) if (p.trim().startsWith('bearer.')) return p.trim().slice(7);
  return null;
}

const signedOut = () => new RelayError(401, 'This machine is signed out of the relay', 'signed_out');

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(req.url);
      const trust = env.CLERK_ISSUER && env.CLERK_CLIENT_ID ? { issuer: env.CLERK_ISSUER.replace(/\/+$/, ''), clientId: env.CLERK_CLIENT_ID } : null;

      // Open: what Omni checks before it starts a sign-in, so a wrong URL or Clerk app fails before Google does.
      if (url.pathname === '/v1/info' && req.method === 'GET') return json({ service: 'omni-relay', version: 1, issuer: trust?.issuer ?? null, clientId: trust?.clientId ?? null });

      if (url.pathname === '/v1/auth/token' && req.method === 'POST') {
        if (!trust) throw new RelayError(503, 'The relay has no Clerk app yet: set CLERK_ISSUER and CLERK_CLIENT_ID (npm run relay:config prints how)');
        const body = (await req.json().catch(() => ({}))) as { idToken?: unknown; machine?: unknown };
        if (typeof body.idToken !== 'string') throw new RelayError(400, 'Send {idToken, machine}');
        const who = await verifyIdToken(body.idToken, trust);
        if (!allowedUsers(env.ALLOWED_USERS).has(who.sub))
          throw new RelayError(403, `${who.email ?? 'That account'} (Clerk user ${who.sub}) may not use this relay. Add the id to the Worker's ALLOWED_USERS`);
        const token = newToken(who.sub);
        const stub = env.RELAY.get(env.RELAY.idFromName(who.sub));
        const res = await stub.fetch('https://relay/internal/token', {
          method: 'POST',
          headers: { 'x-omni-user': who.sub, 'content-type': 'application/json' },
          body: JSON.stringify({ token, machine: typeof body.machine === 'string' ? body.machine : '' }),
        });
        if (!res.ok) return res;
        return json({ token, user: { id: who.sub, email: who.email } });
      }

      if (!url.pathname.startsWith('/v1/')) throw new RelayError(404, 'Not found');
      const token = bearer(req);
      const user = tokenUser(token);
      // Off the allowlist is signed out too: taking a user off cuts every machine of theirs at once.
      if (!user || !allowedUsers(env.ALLOWED_USERS).has(user)) throw signedOut();
      const headers = new Headers(req.headers);
      headers.set('x-omni-user', user);
      headers.set('x-omni-token', token!);
      return env.RELAY.get(env.RELAY.idFromName(user)).fetch(new Request(req, { headers }));
    } catch (err) {
      return failed(err);
    }
  },
} satisfies ExportedHandler<Env>;

/** One user's relay. Only the Worker above calls it, and it has checked the token names this user. */
export class Relay extends DurableObject<Env> {
  private store: RelayStore | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keepalive without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private open(user: string) {
    const bucket = this.env.BUCKET;
    this.store ??= new RelayStore(
      this.ctx.storage.sql,
      {
        put: async (key, body) => void (await bucket.put(key, body, { httpMetadata: { contentType: 'application/json' } })),
        get: async (key) => (await bucket.get(key))?.text() ?? null,
      },
      (fn) => this.ctx.storage.transactionSync(fn),
      user,
    );
    return this.store;
  }

  async fetch(req: Request): Promise<Response> {
    try {
      const url = new URL(req.url);
      const user = req.headers.get('x-omni-user');
      if (!user) throw new RelayError(400, 'No user');
      const store = this.open(user);

      if (url.pathname === '/internal/token') {
        const { token, machine } = (await req.json()) as { token: string; machine: string };
        await store.addToken(token, machine);
        return json({ ok: true });
      }

      const tokenId = await store.checkToken(req.headers.get('x-omni-token') ?? '');
      const path = url.pathname;

      if (path === '/v1/changes' && req.method === 'POST') {
        const pushers = await store.push(await req.json().catch(() => null));
        this.nudge(pushers);
        return json({ ok: true });
      }

      if (path === '/v1/changes' && req.method === 'GET') {
        const q = url.searchParams;
        const after = Number(q.get('after') ?? 0);
        if (!Number.isFinite(after)) throw new RelayError(400, 'after: a number');
        return json({ changes: await store.pull(after, q.get('exclude') ?? '', Number(q.get('limit') ?? 200) || 200) });
      }

      if (path === '/v1/subscribe') {
        if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new RelayError(426, 'Expected a WebSocket');
        const [client, server] = Object.values(new WebSocketPair());
        this.ctx.acceptWebSocket(server, [`m:${url.searchParams.get('exclude') ?? ''}`, `t:${tokenId}`]);
        return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'omni-relay' } });
      }

      if (path === '/v1/auth/token' && req.method === 'DELETE') {
        store.revokeToken(tokenId);
        for (const ws of this.ctx.getWebSockets(`t:${tokenId}`)) ws.close(4001, 'signed out');
        return json({ ok: true });
      }

      if (path.startsWith('/v1/objects/')) {
        let rel = '';
        try {
          rel = decodeURIComponent(path.slice('/v1/objects/'.length));
        } catch {
          // Malformed escapes: refused below as an empty path.
        }
        if (!objectPath(rel)) throw new RelayError(400, `Bad object path "${rel}"`);
        const key = `${user}/files/${rel}`;
        const bucket = this.env.BUCKET;
        if (req.method === 'PUT') {
          await bucket.put(key, await req.arrayBuffer(), { httpMetadata: { contentType: req.headers.get('content-type') ?? 'application/octet-stream' } });
          return json({ ok: true });
        }
        if (req.method === 'HEAD') return new Response(null, { status: (await bucket.head(key)) ? 200 : 404 });
        if (req.method === 'GET') {
          const obj = await bucket.get(key);
          if (!obj) return json({ error: 'No such object' }, 404);
          return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType ?? 'application/octet-stream' } });
        }
      }

      throw new RelayError(404, 'Not found');
    } catch (err) {
      return failed(err);
    }
  }

  /** Tell every machine but the ones that pushed that there is something to pull. */
  private nudge(pushers: Set<string>) {
    for (const ws of this.ctx.getWebSockets()) {
      const machine = this.ctx.getTags(ws).find((t) => t.startsWith('m:'))?.slice(2);
      if ([...pushers].some((m) => m !== machine)) {
        try {
          ws.send('changes');
        } catch {
          // Closing: it pulls on its next connect.
        }
      }
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
