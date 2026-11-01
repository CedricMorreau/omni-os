// Clerk as Omni's identity provider: the Google sign-in that authorizes a new device (apps/server/google-auth.ts).
// Omni is a public OAuth client of the Clerk instance its publishable key names. It holds no Clerk secret key: it
// runs the device authorization grant (RFC 8628), so no install needs a redirect URI of its own, and it checks the
// ID token it gets against the instance's published keys. The token comes straight from Clerk's token endpoint over
// TLS, so the signature check is a second line, not the only one.
import { createPublicKey, createVerify, type JsonWebKeyInput } from 'node:crypto';
import { resolved } from './user-config.ts';

/** The Clerk instance an install signs in with unless its config names another: one shared instance, where anyone can make an account. */
export const DEFAULT_CLERK_PUBLISHABLE_KEY = 'pk_test_Y2VydGFpbi13YWxydXMtNDkxNS5jbGVyay5hY2NvdW50cy5kZXYk';
/** The instance's public OAuth application for Omni. Empty until it exists: Google sign-in stays off. */
export const DEFAULT_CLERK_CLIENT_ID = '';

export interface ClerkConfig {
  /** The instance's Frontend API, like https://certain-walrus-4915.clerk.accounts.dev. The issuer of its tokens. */
  issuer: string;
  clientId: string;
}

/** The Frontend API a publishable key names: `pk_test_` or `pk_live_`, then base64 of the host and a `$`. */
export function issuerFromKey(key: string): string | null {
  const m = /^pk_(?:test|live)_([A-Za-z0-9+/=]+)$/.exec(key.trim());
  if (!m) return null;
  const host = Buffer.from(m[1], 'base64').toString('utf8').replace(/\$$/, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(host) ? `https://${host}` : null;
}

/** This install's Clerk instance and OAuth app, or null while either is missing. */
export function clerkConfig(): ClerkConfig | null {
  const issuer = issuerFromKey(resolved.clerkPublishableKey() || DEFAULT_CLERK_PUBLISHABLE_KEY);
  const clientId = resolved.clerkClientId() || DEFAULT_CLERK_CLIENT_ID;
  return issuer && clientId ? { issuer, clientId } : null;
}

/** Who signed in, from a verified ID token. */
export interface Identity {
  issuer: string;
  sub: string;
  email: string | null;
  name: string | null;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** The verification page with the code filled in, when Clerk offers one. */
  verificationUriComplete: string | null;
  expiresIn: number;
  /** Seconds to wait between polls. */
  interval: number;
}

export type DevicePoll =
  | { state: 'pending' }
  | { state: 'slow_down' }
  | { state: 'denied' }
  | { state: 'expired' }
  /** idToken: the verified token itself, for the sync relay to check on its own (apps/server/sync/setup.ts). */
  | { state: 'done'; identity: Identity; idToken: string };

/** A refusal from Clerk, or Clerk out of reach. */
export class ClerkError extends Error {}

interface Metadata {
  device_authorization_endpoint?: string;
  token_endpoint: string;
  jwks_uri: string;
}

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
/** Leeway for the clocks of this machine and Clerk's. */
const SKEW_S = 60;
const CACHE_MS = 60 * 60_000;

type Fetch = typeof fetch;
/** A public key from the instance's JWKS. */
type Jwk = JsonWebKeyInput['key'] & { kid?: string };

/** One Clerk instance's OAuth endpoints. Tests pass a fake fetch; nothing in the suite reaches Clerk. */
export class ClerkClient {
  private meta: { at: number; value: Promise<Metadata> } | null = null;
  private keys: { at: number; value: Map<string, Jwk> } | null = null;

  constructor(
    readonly config: ClerkConfig,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private metadata(): Promise<Metadata> {
    if (this.meta && this.now() - this.meta.at < CACHE_MS) return this.meta.value;
    const value = this.json<Metadata>(`${this.config.issuer}/.well-known/openid-configuration`);
    this.meta = { at: this.now(), value };
    value.catch(() => (this.meta = null));
    return value;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new ClerkError(`Cannot reach Clerk (${(err as Error).message})`);
    }
    const body = (await res.json().catch(() => ({}))) as T & { error?: string; error_description?: string };
    if (!res.ok && !body.error) throw new ClerkError(`Clerk answered HTTP ${res.status}`);
    return body;
  }

  private form(url: string, fields: Record<string, string>) {
    return this.json<Record<string, unknown> & { error?: string; error_description?: string }>(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
  }

  /** Asks Clerk for a user code to show and a device code to poll with. */
  async startDevice(scope = 'openid email profile'): Promise<DeviceCode> {
    const meta = await this.metadata();
    if (!meta.device_authorization_endpoint) throw new ClerkError('This Clerk instance does not offer device sign-in. Ask Clerk support to turn on the device authorization grant');
    const r = await this.form(meta.device_authorization_endpoint, { client_id: this.config.clientId, scope });
    if (r.error) throw new ClerkError(String(r.error_description || r.error));
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const deviceCode = str(r.device_code);
    const userCode = str(r.user_code);
    const verificationUri = str(r.verification_uri);
    if (!deviceCode || !userCode || !verificationUri) throw new ClerkError('Clerk sent no device code');
    return {
      deviceCode,
      userCode,
      verificationUri,
      verificationUriComplete: str(r.verification_uri_complete),
      expiresIn: Number(r.expires_in) || 600,
      interval: Math.max(1, Number(r.interval) || 5),
    };
  }

  /** One poll of the token endpoint. On approval, the verified identity. */
  async pollDevice(deviceCode: string): Promise<DevicePoll> {
    const meta = await this.metadata();
    const r = await this.form(meta.token_endpoint, { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: this.config.clientId });
    switch (r.error) {
      case undefined:
        break;
      case 'authorization_pending':
        return { state: 'pending' };
      case 'slow_down':
        return { state: 'slow_down' };
      case 'access_denied':
        return { state: 'denied' };
      case 'expired_token':
        return { state: 'expired' };
      default:
        throw new ClerkError(String(r.error_description || r.error));
    }
    if (typeof r.id_token !== 'string') throw new ClerkError('Clerk sent no ID token. The OAuth app needs the openid scope');
    return { state: 'done', identity: await this.verifyIdToken(r.id_token), idToken: r.id_token };
  }

  private async signingKey(kid: string): Promise<Jwk | null> {
    const fresh = this.keys && this.now() - this.keys.at < CACHE_MS;
    if (fresh && this.keys!.value.has(kid)) return this.keys!.value.get(kid)!;
    // A kid we have not seen: Clerk may have rotated its keys, so read them again once.
    const meta = await this.metadata();
    const { keys = [] } = await this.json<{ keys?: Jwk[] }>(meta.jwks_uri);
    this.keys = { at: this.now(), value: new Map(keys.filter((k) => k.kid).map((k) => [k.kid!, k])) };
    return this.keys.value.get(kid) ?? null;
  }

  /** Checks an ID token's RS256 signature, issuer, audience and times. Throws ClerkError when any is off. */
  async verifyIdToken(token: string): Promise<Identity> {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) throw new ClerkError('Malformed ID token');
    let header: { alg?: string; kid?: string };
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
      claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    } catch {
      throw new ClerkError('Malformed ID token');
    }
    if (header.alg !== 'RS256' || !header.kid) throw new ClerkError('ID token is not RS256');
    const jwk = await this.signingKey(header.kid);
    if (!jwk) throw new ClerkError('ID token signed with an unknown key');
    const ok = createVerify('RSA-SHA256').update(`${h}.${p}`).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(s, 'base64url'));
    if (!ok) throw new ClerkError('ID token signature does not match');
    const now = this.now() / 1000;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== this.config.issuer) throw new ClerkError('ID token from another issuer');
    if (!aud.includes(this.config.clientId)) throw new ClerkError('ID token for another app');
    if (typeof claims.exp !== 'number' || claims.exp < now - SKEW_S) throw new ClerkError('ID token expired');
    if (typeof claims.iat === 'number' && claims.iat > now + SKEW_S) throw new ClerkError('ID token issued in the future');
    if (typeof claims.sub !== 'string' || !claims.sub) throw new ClerkError('ID token names no user');
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return { issuer: this.config.issuer, sub: claims.sub, email: text(claims.email), name: text(claims.name) };
  }
}

let shared: { key: string; client: ClerkClient } | null = null;

/** The client for this install's configured instance, or null while Google sign-in is not set up. */
export function clerk(): ClerkClient | null {
  const config = clerkConfig();
  if (!config) return null;
  const key = `${config.issuer}\n${config.clientId}`;
  if (shared?.key !== key) shared = { key, client: new ClerkClient(config) };
  return shared.client;
}
