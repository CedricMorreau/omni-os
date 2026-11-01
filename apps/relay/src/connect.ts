// Omni Connect in one user's Durable Object (docs/adr/0009-omni-connect.md): the machines with a tunnel, the relay's
// own signing key, and the Connect page's sessions. Plain over the Sql interface, like store.ts, so the tests run it
// on node:sqlite with a fake Cloudflare and a fake machine.
import { RelayError, sha256 } from './auth.ts';
import { CloudflareApi, hostnameFor } from './cloudflare.ts';
import {
  HEALTH_REQUEST,
  HEALTH_RESPONSE,
  MINT_REQUEST,
  MINT_RESPONSE,
  newKeyPair,
  publicJwk,
  randomHex,
  RELAY_ISSUER,
  sign,
  verify,
  type EcJwk,
} from './jwt.ts';
import type { Sql } from './store.ts';

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  createdAt: string;
  updatedAt: string;
}

export interface MachineStatus extends Machine {
  online: boolean;
  /** Set when the machine answered but its answer did not check out. */
  problem: string | null;
}

export interface Registered {
  hostname: string;
  connectorToken: string;
  /** The key the machine pins: only requests it signs mint a code. */
  relayKey: EcJwk;
}

type Row = {
  id: string;
  name: string;
  public_key: string;
  hostname: string;
  port: number;
  tunnel_id: string | null;
  dns_record_id: string | null;
  token_id: string;
  created_at: string;
  updated_at: string;
};

/** A request to a machine waits this long. */
const MACHINE_TIMEOUT_MS = 5_000;
/** A mint or health request is good for this long. */
const REQUEST_TTL_S = 60;
/** How long a Connect page sign-in lasts. */
export const CLIENT_DAYS = 30;
const MACHINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const JKT = /^[A-Za-z0-9_-]{43}$/;

export const notConfigured = () =>
  new RelayError(503, 'Omni Connect is not set up on this relay: set CF_API_TOKEN, CF_ACCOUNT_ID, CF_ZONE_ID and CONNECT_ZONE (npm run relay:config prints how)', 'connect_not_configured');

export class ConnectStore {
  constructor(
    private readonly sql: Sql,
    /** Null when the Worker has no Cloudflare secrets: Connect is off, sync still works. */
    private readonly cf: CloudflareApi | null,
    private readonly zone: string | null,
    private readonly user: string,
    private readonly fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS connect_machines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL,
      hostname TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      tunnel_id TEXT,
      dns_record_id TEXT,
      token_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    sql.exec('CREATE TABLE IF NOT EXISTS connect_key (id INTEGER PRIMARY KEY CHECK (id = 1), private_jwk TEXT NOT NULL, public_jwk TEXT NOT NULL)');
    sql.exec(`CREATE TABLE IF NOT EXISTS connect_clients (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL UNIQUE,
      email TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`);
  }

  private iso = () => new Date(this.now()).toISOString();

  private async key(): Promise<{ privateJwk: JsonWebKey; publicJwk: EcJwk }> {
    const [row] = this.sql.exec('SELECT private_jwk, public_jwk FROM connect_key WHERE id = 1').toArray() as { private_jwk: string; public_jwk: string }[];
    if (row && publicJwk(JSON.parse(row.public_jwk))) return { privateJwk: JSON.parse(row.private_jwk), publicJwk: JSON.parse(row.public_jwk) };
    const pair = await newKeyPair();
    if (!pair.publicJwk) throw new RelayError(500, 'The relay could not make its Connect key');
    // A row stored without a usable public key (an earlier build) is replaced, not kept.
    this.sql.exec('DELETE FROM connect_key WHERE id = 1');
    // A Durable Object runs one request at a time, and nothing awaits between this read and write's caller.
    this.sql.exec('INSERT OR IGNORE INTO connect_key (id, private_jwk, public_jwk) VALUES (1, ?, ?)', JSON.stringify(pair.privateJwk), JSON.stringify(pair.publicJwk));
    return this.key();
  }

  private row(id: string): Row | null {
    return (this.sql.exec('SELECT * FROM connect_machines WHERE id = ?', id).toArray()[0] as Row | undefined) ?? null;
  }

  private machine(r: Row): Machine {
    return { id: r.id, name: r.name, hostname: r.hostname, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  // ---------- machines (relay token) ----------

  /** Turn Connect on for a machine, or repair it: the same hostname every time. */
  async register(body: unknown, tokenId: string): Promise<Registered> {
    if (!this.cf || !this.zone) throw notConfigured();
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const id = typeof b.machineId === 'string' ? b.machineId : '';
    if (!MACHINE_ID.test(id)) throw new RelayError(400, 'machineId: 1 to 64 letters, digits, - or _');
    const name = (typeof b.name === 'string' ? b.name.trim() : '').slice(0, 100) || 'Omni';
    const key = publicJwk(b.publicKey);
    if (!key) throw new RelayError(400, 'publicKey: a P-256 public JWK');
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RelayError(400, 'port: 1 to 65535');

    const before = this.row(id);
    const hostname = before?.hostname ?? (await hostnameFor(this.zone, this.user, id, name));
    const tunnel = await this.cf.provision(`omni-${id}`, hostname, port, { tunnelId: before?.tunnel_id });
    const at = this.iso();
    this.sql.exec(
      `INSERT INTO connect_machines (id, name, public_key, hostname, port, tunnel_id, dns_record_id, token_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, public_key = excluded.public_key, port = excluded.port,
         tunnel_id = excluded.tunnel_id, dns_record_id = excluded.dns_record_id, token_id = excluded.token_id, updated_at = excluded.updated_at`,
      id,
      name,
      JSON.stringify(key),
      hostname,
      port,
      tunnel.tunnelId,
      tunnel.dnsRecordId,
      tokenId,
      at,
      at,
    );
    return { hostname, connectorToken: tunnel.connectorToken, relayKey: (await this.key()).publicJwk };
  }

  /** Delete the machine's tunnel, DNS record and row. With a token id, only the machine that token registered. */
  async remove(id: string, tokenId?: string) {
    const r = this.row(id);
    if (!r) return;
    if (tokenId !== undefined && r.token_id !== tokenId) throw new RelayError(403, 'Only that machine can turn its Omni Connect off', 'not_this_machine');
    if (this.cf) await this.cf.remove(r.tunnel_id, r.dns_record_id);
    this.sql.exec('DELETE FROM connect_machines WHERE id = ?', id);
  }

  /** A machine that signs out of the relay loses its tunnel too. Best effort: Cloudflare may be down. */
  async removeForToken(tokenId: string) {
    const rows = this.sql.exec('SELECT id FROM connect_machines WHERE token_id = ?', tokenId).toArray() as { id: string }[];
    for (const { id } of rows) await this.remove(id).catch((err) => console.warn(`[connect] could not remove ${id}: ${(err as Error).message}`));
  }

  list(): Machine[] {
    return (this.sql.exec('SELECT * FROM connect_machines ORDER BY name, id').toArray() as Row[]).map((r) => this.machine(r));
  }

  /** Every machine, with whether its Omni answered a signed health request through its tunnel. */
  async listWithStatus(): Promise<MachineStatus[]> {
    const rows = this.sql.exec('SELECT * FROM connect_machines ORDER BY name, id').toArray() as Row[];
    return Promise.all(
      rows.map(async (r) => {
        try {
          await this.ask(r, 'health', HEALTH_REQUEST, {});
          return { ...this.machine(r), online: true, problem: null };
        } catch (err) {
          const problem = err instanceof RelayError && err.code === 'machine_untrusted' ? err.message : null;
          return { ...this.machine(r), online: false, problem };
        }
      }),
    );
  }

  /** Ask a machine to mint a one-time code bound to the browser key `jkt`. Returns where to send the browser. */
  async open(id: string, jkt: string): Promise<{ url: string; hostname: string }> {
    if (!JKT.test(jkt)) throw new RelayError(400, 'jkt: a key thumbprint');
    const r = this.row(id);
    if (!r) throw new RelayError(404, 'No such machine on Omni Connect');
    const claims = await this.ask(r, 'mint', MINT_REQUEST, { jkt });
    if (claims.jkt !== jkt || typeof claims.code !== 'string' || !/^[A-Za-z0-9_-]{20,200}$/.test(claims.code))
      throw new RelayError(502, `${r.name} answered with a code for another key`, 'machine_untrusted');
    return { hostname: r.hostname, url: `https://${r.hostname}/#/connect?code=${encodeURIComponent(claims.code)}` };
  }

  /**
   * POST a signed request to the machine through its tunnel and check its signed answer: signed by the key it
   * registered, naming the relay and this request's nonce. A different process behind the hostname cannot answer.
   */
  private async ask(r: Row, path: 'mint' | 'health', typ: string, extra: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { privateJwk } = await this.key();
    const nonce = randomHex(16);
    const iat = Math.floor(this.now() / 1000);
    const request = await sign(privateJwk, typ, { iss: RELAY_ISSUER, aud: r.id, sub: this.user, nonce, jti: randomHex(16), iat, exp: iat + REQUEST_TTL_S, ...extra });
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${r.hostname}/api/connect/${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request }),
        // A redirect would leave the machine's hostname.
        redirect: 'manual',
        signal: AbortSignal.timeout(MACHINE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new RelayError(504, `${r.name} is offline (${(err as Error).message})`, 'machine_offline');
    }
    const body = (await res.json().catch(() => null)) as { response?: unknown; error?: unknown } | null;
    if (!res.ok) {
      const why = typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`;
      const offline = res.status >= 500 || res.status === 404;
      throw new RelayError(offline ? 504 : 502, `${r.name} ${offline ? 'is offline' : 'refused'}: ${why}`, offline ? 'machine_offline' : 'machine_refused');
    }
    const claims = typeof body?.response === 'string' ? await verify(body.response, JSON.parse(r.public_key) as EcJwk, path === 'mint' ? MINT_RESPONSE : HEALTH_RESPONSE, this.now()) : null;
    if (!claims || claims.iss !== r.id || claims.aud !== RELAY_ISSUER || claims.nonce !== nonce)
      throw new RelayError(502, `The answer from ${r.hostname} is not signed by ${r.name}`, 'machine_untrusted');
    return claims;
  }

  // ---------- Connect page sessions ----------

  async addClient(token: string, email: string | null) {
    const at = this.now();
    this.sql.exec(
      'INSERT INTO connect_clients (id, hash, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      crypto.randomUUID(),
      await sha256(token),
      email,
      new Date(at).toISOString(),
      new Date(at + CLIENT_DAYS * 86_400_000).toISOString(),
    );
    this.sql.exec('DELETE FROM connect_clients WHERE expires_at < ?', new Date(at).toISOString());
  }

  /** The signed-in email (or null) while the session is live. Throws RelayError(401, signed_out) otherwise. */
  async checkClient(token: string): Promise<{ email: string | null }> {
    const [row] = this.sql.exec('SELECT email, expires_at FROM connect_clients WHERE hash = ?', await sha256(token)).toArray() as { email: string | null; expires_at: string }[];
    if (!row || Date.parse(row.expires_at) < this.now()) throw new RelayError(401, 'Sign in to Omni Connect', 'signed_out');
    return { email: row.email };
  }

  async removeClient(token: string) {
    this.sql.exec('DELETE FROM connect_clients WHERE hash = ?', await sha256(token));
  }
}
