import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ClerkClient, ClerkError, DEFAULT_CLERK_PUBLISHABLE_KEY, issuerFromKey } from '../clerk.ts';
import { FAKE_CLIENT_ID, FAKE_ISSUER, FAKE_PUBLISHABLE_KEY, fakeClerk } from './fake-clerk.ts';

// The Clerk client Google sign-in runs on: the instance a publishable key names, the device authorization grant, and
// the ID token checks. Against fake-clerk.ts; nothing reaches Clerk.

describe('issuerFromKey', () => {
  it("reads the Frontend API out of a publishable key, the shared default's included", () => {
    expect(issuerFromKey(FAKE_PUBLISHABLE_KEY)).toBe(FAKE_ISSUER);
    expect(issuerFromKey(DEFAULT_CLERK_PUBLISHABLE_KEY)).toBe('https://clerk.omni-os.app');
    expect(issuerFromKey(`pk_live_${Buffer.from('clerk.example.com$').toString('base64')}`)).toBe('https://clerk.example.com');
  });

  it('refuses what is not one: a secret key, garbage, a host with a path or a scheme', () => {
    expect(issuerFromKey('sk_test_abc')).toBeNull();
    expect(issuerFromKey('pk_test_!!!')).toBeNull();
    expect(issuerFromKey(`pk_test_${Buffer.from('evil.com/path$').toString('base64')}`)).toBeNull();
    expect(issuerFromKey(`pk_test_${Buffer.from('https://evil.com$').toString('base64')}`)).toBeNull();
    expect(issuerFromKey('')).toBeNull();
  });
});

const setup = () => {
  const clerk = fakeClerk();
  const client = new ClerkClient({ issuer: FAKE_ISSUER, clientId: FAKE_CLIENT_ID }, clerk.fetch as typeof fetch);
  return { clerk, client };
};

describe('ClerkClient: the device authorization grant', () => {
  it('starts with a user code to show, polls pending until approved, then gives the verified identity', async () => {
    const { clerk, client } = setup();
    const code = await client.startDevice();
    expect(code.userCode).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(code.verificationUriComplete).toContain(code.userCode);
    expect(await client.pollDevice(code.deviceCode)).toEqual({ state: 'pending' });
    clerk.approve(code.userCode, { sub: 'user_ada', email: 'ada@example.com', name: 'Ada' });
    expect(await client.pollDevice(code.deviceCode)).toEqual({
      state: 'done',
      identity: { issuer: FAKE_ISSUER, sub: 'user_ada', email: 'ada@example.com', name: 'Ada' },
      // The token itself too, for the sync relay to check on its own.
      idToken: expect.stringMatching(/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/),
    });
  });

  it('reports a denial', async () => {
    const { clerk, client } = setup();
    const code = await client.startDevice();
    clerk.deny(code.userCode);
    expect(await client.pollDevice(code.deviceCode)).toEqual({ state: 'denied' });
  });

  it('says why when the instance offers no device grant', async () => {
    const clerk = fakeClerk();
    const noGrant = (async (url: string, init?: RequestInit) => {
      const res = await clerk.fetch(url, init);
      if (!url.endsWith('openid-configuration')) return res;
      const { device_authorization_endpoint: _, ...rest } = (await res.json()) as Record<string, unknown>;
      return new Response(JSON.stringify(rest));
    }) as typeof fetch;
    const client = new ClerkClient({ issuer: FAKE_ISSUER, clientId: FAKE_CLIENT_ID }, noGrant);
    await expect(client.startDevice()).rejects.toThrow(/device authorization grant/);
  });

  it('turns a network failure into a ClerkError', async () => {
    const client = new ClerkClient({ issuer: FAKE_ISSUER, clientId: FAKE_CLIENT_ID }, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(client.startDevice()).rejects.toBeInstanceOf(ClerkError);
  });
});

describe('ClerkClient.verifyIdToken', () => {
  const ada = { sub: 'user_ada', email: 'ada@example.com' };

  it('takes a token Clerk signed for this app', async () => {
    const { clerk, client } = setup();
    expect((await client.verifyIdToken(clerk.idToken(ada))).sub).toBe('user_ada');
  });

  it('refuses another issuer, another audience, an expired token or one with no subject', async () => {
    const { clerk, client } = setup();
    await expect(client.verifyIdToken(clerk.idToken(ada, { iss: 'https://evil.clerk.accounts.dev' }))).rejects.toThrow(/issuer/);
    await expect(client.verifyIdToken(clerk.idToken(ada, { aud: 'someone-else' }))).rejects.toThrow(/another app/);
    await expect(client.verifyIdToken(clerk.idToken(ada, { exp: Math.floor(Date.now() / 1000) - 3600 }))).rejects.toThrow(/expired/);
    await expect(client.verifyIdToken(clerk.idToken({ sub: '' }))).rejects.toThrow(/no user/);
  });

  it('refuses a token signed with another key, an unknown kid, alg none, or a tampered payload', async () => {
    const { clerk, client } = setup();
    const claims = { iss: FAKE_ISSUER, aud: FAKE_CLIENT_ID, sub: 'user_eve', exp: Math.floor(Date.now() / 1000) + 3600 };
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    await expect(client.verifyIdToken(clerk.sign(claims, { alg: 'RS256', kid: 'key-1' }, other))).rejects.toThrow(/signature/);
    await expect(client.verifyIdToken(clerk.sign(claims, { alg: 'RS256', kid: 'key-9' }))).rejects.toThrow(/unknown key/);
    await expect(client.verifyIdToken(clerk.sign(claims, { alg: 'none', kid: 'key-1' }))).rejects.toThrow(/RS256/);
    const [h, , s] = clerk.idToken(ada).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'user_ada' })).toString('base64url');
    await expect(client.verifyIdToken(`${h}.${forged}.${s}`)).rejects.toThrow(/signature/);
    await expect(client.verifyIdToken('not-a-jwt')).rejects.toThrow(/Malformed/);
  });
});
