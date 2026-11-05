// The Connect page's sign-in: Clerk's device authorization grant, run by the relay as apps/server/clerk.ts runs it
// for a new device. The relay asks Clerk for a code, the page shows it and opens Clerk's page, and the page polls the
// relay with a secret only it holds. The device code never leaves the relay. Pending flows live in one Durable
// Object of their own (SIGNIN_OBJECT), since nobody is signed in yet to own one.
import { RelayError, sha256, type ClerkTrust } from './auth.ts';
import { randomHex } from './jwt.ts';
import type { Sql } from './store.ts';

/** The Durable Object name that holds pending sign-ins. Clerk user ids start with user_, so it names no user. */
export const SIGNIN_OBJECT = '_connect_signin';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const MAX_OPEN = 20;

export interface Started {
  flow: string;
  secret: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  interval: number;
  expiresIn: number;
}

export type Polled = { state: 'pending' | 'slow_down' | 'denied' | 'expired' } | { state: 'done'; idToken: string };

async function form(fetchImpl: typeof fetch, url: string, fields: Record<string, string>) {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(fields).toString(),
    });
  } catch (err) {
    throw new RelayError(502, `Cannot reach Clerk (${(err as Error).message})`);
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && typeof body.error !== 'string') throw new RelayError(502, `Clerk answered HTTP ${res.status}`);
  return body;
}

async function endpoints(trust: ClerkTrust, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${trust.issuer}/.well-known/openid-configuration`).catch(() => null);
  const meta = (await res?.json().catch(() => null)) as { device_authorization_endpoint?: string; token_endpoint?: string } | null;
  if (!meta?.token_endpoint) throw new RelayError(502, "Cannot read Clerk's OpenID configuration");
  if (!meta.device_authorization_endpoint) throw new RelayError(502, 'This Clerk instance does not offer device sign-in. Turn on the device authorization grant on its OAuth app');
  return { device: meta.device_authorization_endpoint, token: meta.token_endpoint };
}

export class SigninStore {
  constructor(
    private readonly sql: Sql,
    private readonly trust: ClerkTrust,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    sql.exec('CREATE TABLE IF NOT EXISTS signin_flows (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, device_code TEXT NOT NULL, expires_at INTEGER NOT NULL)');
  }

  async start(): Promise<Started> {
    this.sql.exec('DELETE FROM signin_flows WHERE expires_at < ?', this.now());
    const [{ n }] = this.sql.exec('SELECT count(*) AS n FROM signin_flows').toArray() as { n: number }[];
    if (Number(n) >= MAX_OPEN) throw new RelayError(429, 'Too many sign-ins at once. Try again in a few minutes');
    const { device } = await endpoints(this.trust, this.fetchImpl);
    const r = await form(this.fetchImpl, device, { client_id: this.trust.clientId, scope: 'openid email profile' });
    if (typeof r.error === 'string') throw new RelayError(502, String(r.error_description || r.error));
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const deviceCode = str(r.device_code);
    const userCode = str(r.user_code);
    const verificationUri = str(r.verification_uri);
    if (!deviceCode || !userCode || !verificationUri) throw new RelayError(502, 'Clerk sent no device code');
    const expiresIn = Number(r.expires_in) || 600;
    const flow = randomHex(16);
    const secret = randomHex(32);
    this.sql.exec('INSERT INTO signin_flows (id, secret_hash, device_code, expires_at) VALUES (?, ?, ?, ?)', flow, await sha256(secret), deviceCode, this.now() + expiresIn * 1000);
    return { flow, secret, userCode, verificationUri, verificationUriComplete: str(r.verification_uri_complete), interval: Math.max(1, Number(r.interval) || 5), expiresIn };
  }

  /** One poll of Clerk for this flow. A finished flow (done, denied, expired) is gone afterwards. */
  async poll(flow: string, secret: string): Promise<Polled> {
    const [row] = this.sql.exec('SELECT secret_hash, device_code, expires_at FROM signin_flows WHERE id = ?', flow).toArray() as {
      secret_hash: string;
      device_code: string;
      expires_at: number;
    }[];
    if (!row || row.secret_hash !== (await sha256(secret))) throw new RelayError(404, 'No such sign-in. Start again');
    const end = () => this.sql.exec('DELETE FROM signin_flows WHERE id = ?', flow);
    if (Number(row.expires_at) < this.now()) {
      end();
      return { state: 'expired' };
    }
    const { token } = await endpoints(this.trust, this.fetchImpl);
    const r = await form(this.fetchImpl, token, { grant_type: DEVICE_GRANT, device_code: row.device_code, client_id: this.trust.clientId });
    switch (r.error) {
      case undefined:
        break;
      case 'authorization_pending':
        return { state: 'pending' };
      case 'slow_down':
        return { state: 'slow_down' };
      case 'access_denied':
        end();
        return { state: 'denied' };
      case 'expired_token':
        end();
        return { state: 'expired' };
      default:
        end();
        throw new RelayError(502, String(r.error_description || r.error));
    }
    end();
    if (typeof r.id_token !== 'string') throw new RelayError(502, 'Clerk sent no ID token. The OAuth app needs the openid scope');
    return { state: 'done', idToken: r.id_token };
  }
}
