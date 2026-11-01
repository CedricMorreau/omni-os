// OAuth for /mcp through Clerk: how claude.ai, ChatGPT and other MCP clients sign in with Google instead of holding
// data/mcp-token. Omni is the protected resource and the Clerk instance that Google sign-in uses (apps/server/clerk.ts)
// is the authorization server. A client finds Clerk through the metadata here (RFC 9728), registers and signs in there,
// and sends the access token it gets to /mcp.
//
// Omni holds no Clerk secret key, so it cannot introspect a token. It asks Clerk's userinfo endpoint instead, which
// answers for opaque and JWT access tokens alike, and takes the token only when its user is this install's owner
// (google-auth.ts). Answers are cached briefly, so a busy client costs one Clerk call a minute.
import { createHash } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { DEFAULT_CLERK_PUBLISHABLE_KEY, issuerFromKey } from './clerk.ts';
import { owner } from './google-auth.ts';
import { mcpHostAllowed } from './request-guard.ts';
import { resolved } from './user-config.ts';

/** What a client asks Clerk for: enough for userinfo to name the user. */
export const MCP_SCOPES = ['openid', 'profile', 'email'];

/** How long Clerk's answer for a token holds: a live one, and a refused one. */
const OK_MS = 60_000;
const NO_MS = 10_000;
const CACHE_MAX = 500;
const META_MS = 10 * 60_000;

/**
 * The Clerk instance MCP clients sign in with: the configured one, while an owner from that instance is linked.
 * Null: OAuth is off for /mcp, and only the static tokens get in.
 */
export function mcpIssuer(): string | null {
  const issuer = issuerFromKey(resolved.clerkPublishableKey() || DEFAULT_CLERK_PUBLISHABLE_KEY);
  return issuer && owner()?.issuer === issuer ? issuer : null;
}

let fetchImpl: typeof fetch = (...args) => fetch(...args);
const answers = new Map<string, { at: number; sub: string | null }>();
let asMetadata: { issuer: string; at: number; body: Promise<unknown> } | null = null;

/** For tests: the fetch that reaches Clerk, and a clean cache. */
export function setOAuthFetch(f?: typeof fetch) {
  fetchImpl = f ?? ((...args) => fetch(...args));
  answers.clear();
  asMetadata = null;
}

/** Clerk did not answer, so a token could not be checked either way. */
export class ClerkUnreachable extends Error {}

/** The user Clerk's userinfo names for `token`, or null when Clerk refuses it. */
async function userinfoSub(issuer: string, token: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${issuer}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new ClerkUnreachable(`Cannot reach Clerk (${(err as Error).message})`);
  }
  if (res.status >= 500) throw new ClerkUnreachable(`Clerk answered HTTP ${res.status}`);
  if (!res.ok) return null;
  const body = (await res.json().catch(() => ({}))) as { sub?: unknown };
  return typeof body.sub === 'string' && body.sub ? body.sub : null;
}

/**
 * Whether `token` is a Clerk OAuth access token for this install's owner. False while OAuth is off.
 * Throws ClerkUnreachable when Clerk could not be asked.
 */
export async function isOwnerToken(token: string, now = Date.now()): Promise<boolean> {
  const issuer = mcpIssuer();
  if (!issuer || !token) return false;
  const key = createHash('sha256').update(`${issuer}\n${token}`).digest('hex');
  const hit = answers.get(key);
  let sub = hit && now - hit.at < (hit.sub ? OK_MS : NO_MS) ? hit.sub : undefined;
  if (sub === undefined) {
    sub = await userinfoSub(issuer, token);
    if (answers.size >= CACHE_MAX) for (const [k, v] of answers) if (now - v.at >= OK_MS) answers.delete(k);
    if (answers.size < CACHE_MAX) answers.set(key, { at: now, sub });
  }
  return sub !== null && sub === owner()?.sub;
}

/** The address a client reached this server on: through a Cloudflare Tunnel, the https public name cloudflared passes on. */
export function publicBase(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0].trim() || url.protocol.replace(':', '');
  const host = c.req.header('x-forwarded-host')?.split(',')[0].trim() || c.req.header('host') || url.host;
  return `${proto}://${host}`;
}

/** The metadata URL a 401 from /mcp points clients at. */
export const resourceMetadataUrl = (c: Context) => `${publicBase(c)}/.well-known/oauth-protected-resource/mcp`;

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

// Public documents every client may read, browser-based ones (the MCP Inspector) included.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'mcp-protocol-version' };

/** Clerk's authorization server metadata, read at most every ten minutes. */
function clerkMetadata(issuer: string, now = Date.now()): Promise<unknown> {
  if (asMetadata?.issuer === issuer && now - asMetadata.at < META_MS) return asMetadata.body;
  const body = fetchImpl(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(10_000) }).then((r) => {
    if (!r.ok) throw new ClerkUnreachable(`Clerk answered HTTP ${r.status}`);
    return r.json();
  });
  asMetadata = { issuer, at: now, body };
  body.catch(() => (asMetadata = null));
  return body;
}

/**
 * /.well-known: the protected resource metadata for /mcp, and Clerk's authorization server metadata again, for
 * clients on the 2025-03-26 MCP spec that look for it on the server they connect to. Both 404 while OAuth is off.
 */
export const oauthMetadataApi = new Hono();

oauthMetadataApi.use('*', async (c, next) => {
  if (!mcpHostAllowed(hostnameOf(c.req.header('host') ?? new URL(c.req.url).host))) return c.json({ error: 'Forbidden: host not allowed' }, 403);
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  await next();
  for (const [k, v] of Object.entries(CORS)) c.res.headers.set(k, v);
});

const protectedResource = (c: Context) => {
  const issuer = mcpIssuer();
  if (!issuer) return c.json({ error: 'Google sign-in for MCP is off: link a Google account in Settings, Machines' }, 404);
  return c.json({
    resource: `${publicBase(c)}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: 'Omni',
  });
};
oauthMetadataApi.get('/oauth-protected-resource', protectedResource);
oauthMetadataApi.get('/oauth-protected-resource/mcp', protectedResource);

const authorizationServer = async (c: Context) => {
  const issuer = mcpIssuer();
  if (!issuer) return c.json({ error: 'Google sign-in for MCP is off' }, 404);
  try {
    return c.json(await clerkMetadata(issuer));
  } catch (err) {
    return c.json({ error: (err as Error).message }, 502);
  }
};
oauthMetadataApi.get('/oauth-authorization-server', authorizationServer);
oauthMetadataApi.get('/oauth-authorization-server/mcp', authorizationServer);
