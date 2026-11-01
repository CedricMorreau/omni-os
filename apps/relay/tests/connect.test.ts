import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CLIENT_PREFIX, newToken, RelayError, tokenUser } from '../src/auth.ts';
import { CloudflareApi, hostnameFor } from '../src/cloudflare.ts';
import { ConnectStore } from '../src/connect.ts';
import { HEALTH_REQUEST, HEALTH_RESPONSE, MINT_REQUEST, MINT_RESPONSE, newKeyPair, RELAY_ISSUER, sign, thumbprint, verify, type EcJwk } from '../src/jwt.ts';
import { SigninStore } from '../src/signin.ts';
import type { Sql } from '../src/store.ts';

function sqlOn(db: DatabaseSync): Sql {
  return {
    exec: (q, ...b) => {
      const rows = (q.trim().toUpperCase().startsWith('SELECT') ? db.prepare(q).all(...b) : (db.prepare(q).run(...b), [])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
}

/** Cloudflare's API as far as provisioning goes: tunnels, their configs and tokens, and DNS records. */
function fakeCloudflare() {
  const tunnels = new Map<string, { name: string; deleted: boolean; config?: unknown }>();
  const records = new Map<string, { name: string; content: string }>();
  const calls: string[] = [];
  let n = 0;
  const ok = (result: unknown) => Response.json({ success: true, result });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname.replace('/client/v4', '');
    calls.push(`${method} ${path}`);
    let m: RegExpMatchArray | null;
    if ((m = path.match(/^\/accounts\/acct\/cfd_tunnel$/))) {
      if (method === 'POST') {
        const id = `t${++n}`;
        tunnels.set(id, { name: body.name, deleted: false });
        return ok({ id });
      }
      const name = url.searchParams.get('name');
      return ok([...tunnels].filter(([, t]) => t.name === name && !t.deleted).map(([id]) => ({ id })));
    }
    if ((m = path.match(/^\/accounts\/acct\/cfd_tunnel\/(\w+)(\/(configurations|token))?$/))) {
      const t = tunnels.get(m[1]);
      if (!t) return Response.json({ success: false, errors: [{ code: 1003, message: 'not found' }] }, { status: 404 });
      if (m[3] === 'configurations') return ok((t.config = body.config));
      if (m[3] === 'token') return ok(`token-for-${m[1]}`);
      if (method === 'DELETE') return ok((t.deleted = true));
      return ok({ id: m[1], deleted_at: t.deleted ? '2026-11-01' : null });
    }
    if ((m = path.match(/^\/zones\/zone\/dns_records(\/(\w+))?$/))) {
      if (method === 'GET') return ok([...records].filter(([, r]) => r.name === url.searchParams.get('name')).map(([id, r]) => ({ id, ...r })));
      if (method === 'POST') {
        const id = `r${++n}`;
        records.set(id, { name: body.name, content: body.content });
        return ok({ id });
      }
      if (method === 'PATCH') return ok(Object.assign(records.get(m[2])!, body));
      if (method === 'DELETE') return ok(records.delete(m[2]));
    }
    return Response.json({ success: false, errors: [{ code: 0, message: `no fake for ${method} ${path}` }] }, { status: 400 });
  }) as typeof fetch;
  return { fetchImpl, tunnels, records, calls };
}

/** A machine behind its tunnel: checks the relay's request with the pinned key and answers signed. */
async function fakeMachine(opts: { relayKey: () => EcJwk; machineId: string; owner: string }) {
  const keys = await newKeyPair();
  const seen = new Set<string>();
  const override: { response?: (claims: Record<string, unknown>) => Promise<string> } = {};
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const kind = url.pathname === '/api/connect/mint' ? 'mint' : 'health';
    const { request } = JSON.parse(String(init!.body));
    const claims = await verify(request, opts.relayKey(), kind === 'mint' ? MINT_REQUEST : HEALTH_REQUEST);
    if (!claims || claims.aud !== opts.machineId || claims.sub !== opts.owner || seen.has(String(claims.jti))) return Response.json({ error: 'refused' }, { status: 403 });
    seen.add(String(claims.jti));
    const now = Math.floor(Date.now() / 1000);
    const answer = { iss: opts.machineId, aud: RELAY_ISSUER, nonce: claims.nonce, exp: now + 60, ...(kind === 'mint' ? { jkt: claims.jkt, code: 'code_abcdefghijklmnopqrstuvwxyz' } : {}) };
    const response = override.response ? await override.response(answer) : await sign(keys.privateJwk, kind === 'mint' ? MINT_RESPONSE : HEALTH_RESPONSE, answer);
    return Response.json({ response });
  }) as typeof fetch;
  return { keys, fetchImpl, override };
}

async function setup() {
  const db = new DatabaseSync(':memory:');
  const cf = fakeCloudflare();
  let relayKey: EcJwk | null = null;
  const machine = await fakeMachine({ relayKey: () => relayKey!, machineId: 'mac-1', owner: 'user_ben' });
  const store = new ConnectStore(sqlOn(db), new CloudflareApi({ token: 't', accountId: 'acct', zoneId: 'zone', zone: 'omni-os.app' }, cf.fetchImpl), 'omni-os.app', 'user_ben', machine.fetchImpl);
  const register = async (port = 4747, name = "Ben's MacBook Pro") => {
    const r = await store.register({ machineId: 'mac-1', name, publicKey: machine.keys.publicJwk, port }, 'tok-1');
    relayKey = r.relayKey;
    return r;
  };
  return { db, cf, machine, store, register };
}

describe('hostnameFor', () => {
  it('is the name as one DNS label plus 6 hex, under the zone', async () => {
    const h = await hostnameFor('omni-os.app', 'user_ben', 'mac-1', "Ben's MacBook Pro");
    expect(h).toMatch(/^ben-s-macbook-pro-[0-9a-f]{6}\.omni-os\.app$/);
    expect(await hostnameFor('omni-os.app', 'user_ben', 'mac-1', 'Other name')).toMatch(h.slice(-17));
    expect(await hostnameFor('omni-os.app', 'user_ben', 'mac-1', '日本')).toMatch(/^omni-[0-9a-f]{6}\.omni-os\.app$/);
  });
});

describe('ConnectStore.register', () => {
  it('makes a tunnel, its ingress and a proxied CNAME, and answers with the connector token and the relay key', async () => {
    const { cf, register } = await setup();
    const r = await register();
    expect(r.hostname).toMatch(/\.omni-os\.app$/);
    expect(r.connectorToken).toBe('token-for-t1');
    expect(r.relayKey).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(cf.tunnels.get('t1')).toMatchObject({ name: 'omni-mac-1', config: { ingress: [{ hostname: r.hostname, service: 'http://127.0.0.1:4747' }, { service: 'http_status:404' }] } });
    expect([...cf.records.values()]).toEqual([{ name: r.hostname, content: 't1.cfargotunnel.com' }]);
  });

  it('registering again keeps the hostname and tunnel, and moves the ingress to the new port', async () => {
    const { cf, register } = await setup();
    const first = await register(4747);
    const again = await register(4800, 'Renamed');
    expect(again.hostname).toBe(first.hostname);
    expect(cf.tunnels.size).toBe(1);
    expect(cf.records.size).toBe(1);
    expect((cf.tunnels.get('t1')!.config as { ingress: { service: string }[] }).ingress[0].service).toBe('http://127.0.0.1:4800');
  });

  it('makes a new tunnel when the recorded one was deleted, and points the DNS record at it', async () => {
    const { cf, register } = await setup();
    const first = await register();
    cf.tunnels.get('t1')!.deleted = true;
    const again = await register();
    expect(again.connectorToken).not.toBe(first.connectorToken);
    expect([...cf.records.values()][0].content).toMatch(/^t\d+\.cfargotunnel\.com$/);
    expect([...cf.records.values()][0].content).not.toBe('t1.cfargotunnel.com');
  });

  it('refuses a private key, a bad id or port', async () => {
    const { store, machine } = await setup();
    await expect(store.register({ machineId: 'mac-1', publicKey: { ...machine.keys.publicJwk, d: 'x' }, port: 4747 }, 't')).rejects.toThrow(/publicKey/);
    await expect(store.register({ machineId: '../x', publicKey: machine.keys.publicJwk, port: 4747 }, 't')).rejects.toThrow(/machineId/);
    await expect(store.register({ machineId: 'm', publicKey: machine.keys.publicJwk, port: 0 }, 't')).rejects.toThrow(/port/);
  });

  it('answers connect_not_configured without Cloudflare secrets', async () => {
    const store = new ConnectStore(sqlOn(new DatabaseSync(':memory:')), null, null, 'user_ben');
    await expect(store.register({}, 't')).rejects.toMatchObject({ status: 503, code: 'connect_not_configured' });
  });
});

describe('ConnectStore.open', () => {
  const jkt = 'A'.repeat(43);

  it('gets a code the machine minted for this key and sends the browser to the machine', async () => {
    const { store, register } = await setup();
    const { hostname } = await register();
    const r = await store.open('mac-1', jkt);
    expect(r.url).toBe(`https://${hostname}/#/connect?code=code_abcdefghijklmnopqrstuvwxyz`);
  });

  it('refuses an answer signed by another key: a different process behind the hostname', async () => {
    const { store, register, machine } = await setup();
    await register();
    const impostor = await newKeyPair();
    machine.override.response = (claims) => sign(impostor.privateJwk, MINT_RESPONSE, claims);
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
  });

  it('refuses an answer for another nonce or key, as a replay would be', async () => {
    const { store, register, machine } = await setup();
    await register();
    machine.override.response = (claims) => sign(machine.keys.privateJwk, MINT_RESPONSE, { ...claims, nonce: 'old' });
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
    machine.override.response = (claims) => sign(machine.keys.privateJwk, MINT_RESPONSE, { ...claims, jkt: 'B'.repeat(43) });
    await expect(store.open('mac-1', jkt)).rejects.toMatchObject({ code: 'machine_untrusted' });
  });

  it('says a machine that does not answer is offline, and lists it that way', async () => {
    const { db, cf } = await setup();
    const down = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as unknown as typeof fetch;
    const store = new ConnectStore(sqlOn(db), new CloudflareApi({ token: 't', accountId: 'acct', zoneId: 'zone', zone: 'omni-os.app' }, cf.fetchImpl), 'omni-os.app', 'user_ben', down);
    const m = await newKeyPair();
    await store.register({ machineId: 'mac-2', name: 'Studio', publicKey: m.publicJwk, port: 4747 }, 'tok');
    await expect(store.open('mac-2', jkt)).rejects.toMatchObject({ code: 'machine_offline' });
    expect(await store.listWithStatus()).toMatchObject([{ id: 'mac-2', online: false, problem: null }]);
  });

  it('lists an answering machine as online', async () => {
    const { store, register } = await setup();
    await register();
    expect(await store.listWithStatus()).toMatchObject([{ id: 'mac-1', name: "Ben's MacBook Pro", online: true }]);
  });

  it('refuses a bad jkt and an unknown machine', async () => {
    const { store, register } = await setup();
    await register();
    await expect(store.open('mac-1', 'short')).rejects.toThrow(/jkt/);
    await expect(store.open('nope', jkt)).rejects.toMatchObject({ status: 404 });
  });
});

describe('ConnectStore.remove', () => {
  it('deletes the DNS record, the tunnel and the row', async () => {
    const { store, cf, register } = await setup();
    await register();
    await store.remove('mac-1');
    expect(cf.records.size).toBe(0);
    expect(cf.tunnels.get('t1')!.deleted).toBe(true);
    expect(store.list()).toEqual([]);
  });

  it('only the token that registered a machine can remove it', async () => {
    const { store, cf, register } = await setup();
    await register();
    await expect(store.remove('mac-1', 'tok-other')).rejects.toMatchObject({ status: 403 });
    expect(cf.records.size).toBe(1);
    await store.remove('mac-1', 'tok-1');
    expect(store.list()).toEqual([]);
  });

  it('removes the machines of a relay token that signs out', async () => {
    const { store, register } = await setup();
    await register();
    await store.removeForToken('other');
    expect(store.list()).toHaveLength(1);
    await store.removeForToken('tok-1');
    expect(store.list()).toEqual([]);
  });
});

describe('Connect page sessions', () => {
  it('a session works until it is removed or expires', async () => {
    const db = new DatabaseSync(':memory:');
    let clock = Date.parse('2026-11-01T12:00:00Z');
    const store = new ConnectStore(sqlOn(db), null, null, 'user_ben', fetch, () => clock);
    const token = newToken('user_ben', CLIENT_PREFIX);
    expect(tokenUser(token, CLIENT_PREFIX)).toBe('user_ben');
    expect(tokenUser(token)).toBeNull();
    await store.addClient(token, 'ben@example.com');
    expect(await store.checkClient(token)).toEqual({ email: 'ben@example.com' });
    clock += 31 * 86_400_000;
    await expect(store.checkClient(token)).rejects.toBeInstanceOf(RelayError);
    const other = newToken('user_ben', CLIENT_PREFIX);
    await store.addClient(other, null);
    await store.removeClient(other);
    await expect(store.checkClient(other)).rejects.toMatchObject({ code: 'signed_out' });
  });
});

describe('SigninStore', () => {
  function fakeClerk(answers: Record<string, unknown>[]) {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/.well-known/openid-configuration'))
        return Response.json({ device_authorization_endpoint: 'https://clerk.test/oauth/device', token_endpoint: 'https://clerk.test/oauth/token' });
      if (url.endsWith('/oauth/device')) return Response.json({ device_code: 'dev', user_code: 'ABCD-EFGH', verification_uri: 'https://clerk.test/device', interval: 5, expires_in: 600 });
      const answer = answers.shift() ?? { error: 'authorization_pending' };
      return Response.json(answer, { status: 'error' in answer ? 400 : 200 });
    }) as typeof fetch;
  }
  const trust = { issuer: 'https://clerk.test', clientId: 'client' };

  it('keeps the device code and hands out a flow and secret; a poll with the wrong secret is refused', async () => {
    const store = new SigninStore(sqlOn(new DatabaseSync(':memory:')), trust, fakeClerk([{ error: 'authorization_pending' }, { id_token: 'id.token.here' }]));
    const f = await store.start();
    expect(f).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://clerk.test/device', interval: 5 });
    expect(JSON.stringify(f)).not.toContain('"dev"');
    await expect(store.poll(f.flow, 'wrong')).rejects.toMatchObject({ status: 404 });
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'pending' });
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'done', idToken: 'id.token.here' });
    await expect(store.poll(f.flow, f.secret)).rejects.toMatchObject({ status: 404 });
  });

  it('ends a declined flow', async () => {
    const store = new SigninStore(sqlOn(new DatabaseSync(':memory:')), trust, fakeClerk([{ error: 'access_denied' }]));
    const f = await store.start();
    expect(await store.poll(f.flow, f.secret)).toEqual({ state: 'denied' });
  });
});

describe('jwt', () => {
  it('thumbprint is RFC 7638 for a P-256 key', async () => {
    // RFC 7638 has no EC example; this pins our canonical form so the server's copy can be checked against it.
    expect(await thumbprint({ kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' })).toBe(
      'oKIywvGUpTVTyxMQ3bwIIeQUudfr_CkLMjCE19ECD-U',
    );
  });
});
