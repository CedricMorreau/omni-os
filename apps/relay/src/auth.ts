// Who may use the relay. A machine signs in once: Omni runs Clerk's device grant (apps/server/clerk.ts) and hands the
// relay the ID token it got. The relay checks it against the Clerk instance's published keys, and that its user is
// on ALLOWED_USERS, then gives that machine a relay token of its own. The ID token is never kept.
// Plain WebCrypto and fetch, so the tests run it under Node.

export interface ClerkTrust {
  /** The instance's Frontend API, like https://certain-walrus-4915.clerk.accounts.dev. */
  issuer: string;
  /** Omni's OAuth app on that instance: the audience of its ID tokens. */
  clientId: string;
}

export interface Identity {
  sub: string;
  email: string | null;
}

/** A refusal the relay answers with this status and message. */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Leeway for clocks. */
const SKEW_S = 60;
/** An ID token older than this is not exchanged: Omni sends it right after Clerk issues it. */
const MAX_AGE_S = 10 * 60;
const KEYS_MS = 60 * 60_000;

type Jwk = JsonWebKey & { kid?: string };
let keys: { issuer: string; at: number; byKid: Map<string, Jwk> } | null = null;

const b64urlBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
const b64urlJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlBytes(s))) as Record<string, unknown>;

async function signingKey(issuer: string, kid: string, fetchImpl: typeof fetch, now: number): Promise<Jwk | null> {
  const fresh = keys && keys.issuer === issuer && now - keys.at < KEYS_MS;
  if (fresh && keys!.byKid.has(kid)) return keys!.byKid.get(kid)!;
  // A kid not seen yet: Clerk may have rotated its keys, so read them again.
  const res = await fetchImpl(`${issuer}/.well-known/jwks.json`);
  if (!res.ok) throw new RelayError(502, `Cannot read Clerk's keys (HTTP ${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  keys = { issuer, at: now, byKid: new Map((body.keys ?? []).filter((k) => k.kid).map((k) => [k.kid!, k])) };
  return keys.byKid.get(kid) ?? null;
}

/** Checks an ID token's RS256 signature, issuer, audience and times. Throws RelayError(401) when any is off. */
export async function verifyIdToken(token: string, trust: ClerkTrust, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<Identity> {
  const bad = (why: string) => new RelayError(401, why);
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) throw bad('Malformed ID token');
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = b64urlJson(h);
    claims = b64urlJson(p);
  } catch {
    throw bad('Malformed ID token');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw bad('ID token is not RS256');
  const jwk = await signingKey(trust.issuer, header.kid, fetchImpl, nowMs);
  if (!jwk) throw bad('ID token signed with an unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw bad('ID token signature does not match');
  const now = nowMs / 1000;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== trust.issuer) throw bad('ID token from another Clerk instance');
  if (!aud.includes(trust.clientId)) throw bad('ID token for another app');
  if (typeof claims.exp !== 'number' || claims.exp < now - SKEW_S) throw bad('ID token expired');
  if (typeof claims.iat !== 'number' || claims.iat > now + SKEW_S || claims.iat < now - MAX_AGE_S) throw bad('ID token too old: sign in again');
  if (typeof claims.sub !== 'string' || !claims.sub) throw bad('ID token names no user');
  const email = typeof claims.email === 'string' && claims.email ? claims.email : null;
  return { sub: claims.sub, email };
}

/** ALLOWED_USERS: Clerk user ids, separated by commas or whitespace. */
export const allowedUsers = (raw: string | undefined) => new Set((raw ?? '').split(/[\s,]+/).filter(Boolean));

// ---------- relay tokens ----------

/** A machine's relay token. */
export const MACHINE_PREFIX = 'omni_r_';
/** A Connect page session (connect.ts), kept in an HttpOnly cookie on the relay's origin. */
export const CLIENT_PREFIX = 'omni_c_';

/** A new token for this user: the user id (so the Worker knows which Durable Object holds it) and 32 random bytes. */
export function newToken(sub: string, prefix = MACHINE_PREFIX): string {
  const user = btoa(sub).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}${user}.${random}`;
}

/** The user a token with this prefix names, or null for something that is not one. Says nothing about whether it is live. */
export function tokenUser(token: string | null | undefined, prefix = MACHINE_PREFIX): string | null {
  if (!token?.startsWith(prefix)) return null;
  const [user, random] = token.slice(prefix.length).split('.');
  if (!user || !random || !/^[0-9a-f]{64}$/.test(random)) return null;
  try {
    return new TextDecoder().decode(b64urlBytes(user)) || null;
  } catch {
    return null;
  }
}

export async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
