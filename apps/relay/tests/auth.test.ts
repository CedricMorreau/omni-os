import { describe, expect, it } from 'vitest';
import { allowedUsers, newToken, RelayError, tokenUser, verifyIdToken } from '../src/auth.ts';

const trust = { issuer: 'https://clerk.example.dev', clientId: 'omni-app' };
const now = Date.parse('2026-11-01T12:00:00Z');
const s = now / 1000;

const { privateKey, publicKey } = (await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
)) as CryptoKeyPair;
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1' };
const b64 = (v: string | Uint8Array) => Buffer.from(v).toString('base64url');

async function idToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }) {
  const head = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(head)));
  return `${head}.${b64(sig)}`;
}

const good = { iss: trust.issuer, aud: 'omni-app', sub: 'user_ben', email: 'ben@example.com', iat: s - 5, exp: s + 300 };
let jwksCalls = 0;
const clerk = (async (url: string) => {
  jwksCalls++;
  expect(url).toBe('https://clerk.example.dev/.well-known/jwks.json');
  return Response.json({ keys: [jwk] });
}) as typeof fetch;

const refusal = (p: Promise<unknown>) => p.then(() => null, (e: RelayError) => (expect(e).toBeInstanceOf(RelayError), e.message));

describe('verifyIdToken', () => {
  it('takes a token Clerk signed for Omni, and keeps the keys', async () => {
    expect(await verifyIdToken(await idToken(good), trust, clerk, now)).toEqual({ sub: 'user_ben', email: 'ben@example.com' });
    const before = jwksCalls;
    await verifyIdToken(await idToken(good), trust, clerk, now);
    expect(jwksCalls).toBe(before);
  });

  it('refuses another issuer, another app, an expired or old token, and no user', async () => {
    expect(await refusal(verifyIdToken(await idToken({ ...good, iss: 'https://evil.dev' }), trust, clerk, now))).toMatch(/another Clerk/);
    expect(await refusal(verifyIdToken(await idToken({ ...good, aud: 'other' }), trust, clerk, now))).toMatch(/another app/);
    expect(await refusal(verifyIdToken(await idToken({ ...good, exp: s - 120 }), trust, clerk, now))).toMatch(/expired/);
    expect(await refusal(verifyIdToken(await idToken({ ...good, iat: s - 3600 }), trust, clerk, now))).toMatch(/too old/);
    expect(await refusal(verifyIdToken(await idToken({ ...good, sub: '' }), trust, clerk, now))).toMatch(/no user/);
  });

  it('refuses a forged signature, another algorithm and an unknown key', async () => {
    const t = await idToken(good);
    const forged = t.split('.').slice(0, 2).join('.') + '.' + b64(new Uint8Array(256));
    expect(await refusal(verifyIdToken(forged, trust, clerk, now))).toMatch(/signature/);
    expect(await refusal(verifyIdToken(await idToken(good, { alg: 'HS256', kid: 'k1' }), trust, clerk, now))).toMatch(/RS256/);
    expect(await refusal(verifyIdToken(await idToken(good, { alg: 'RS256', kid: 'nope' }), trust, clerk, now))).toMatch(/unknown key/);
    expect(await refusal(verifyIdToken('not-a-jwt', trust, clerk, now))).toMatch(/Malformed/);
  });
});

describe('relay tokens', () => {
  it('name their user, and nothing else passes', () => {
    const t = newToken('user_2abc+/=');
    expect(t).toMatch(/^omni_r_[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
    expect(tokenUser(t)).toBe('user_2abc+/=');
    expect(newToken('user_2abc')).not.toBe(newToken('user_2abc'));
    for (const bad of [null, '', 'omni_s_abc', 'omni_r_dXNlcg', 'omni_r_dXNlcg.short']) expect(tokenUser(bad)).toBeNull();
  });

  it('reads ALLOWED_USERS split by commas or spaces', () => {
    expect([...allowedUsers(' user_a, user_b\nuser_c ')]).toEqual(['user_a', 'user_b', 'user_c']);
    expect(allowedUsers(undefined).size).toBe(0);
  });
});
