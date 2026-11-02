import { describe, expect, it } from 'vitest';
import { apiPath, createHttpClient, OmniHttpError, parseBaseUrl, type BaseUrl, type Fetch, type HttpFailure } from '../src/http.ts';

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

const base = parseBaseUrl('http://127.0.0.1:4757') as BaseUrl;

function fake(reply: { status?: number; type?: string | null; text?: string } | (() => Promise<never>) = {}) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    sent.push({ url, method: init.method, headers: init.headers, body: init.body });
    if (typeof reply === 'function') return reply();
    const { status = 200, type = 'application/json; charset=UTF-8', text = '{}' } = reply;
    return { status, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : null) }, text: async () => text };
  };
  return { sent, fetch };
}

async function rejected(p: Promise<unknown>): Promise<OmniHttpError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OmniHttpError);
  return err as OmniHttpError;
}

const failure = async (p: Promise<unknown>): Promise<HttpFailure> => (await rejected(p)).failure;

describe('parseBaseUrl', () => {
  it.each([
    ['http://127.0.0.1:4747', 'http://127.0.0.1:4747'],
    ['https://mac.tail1234.ts.net/', 'https://mac.tail1234.ts.net'],
    ['  HTTPS://omni.example.com/prefix//  ', 'https://omni.example.com/prefix'],
    ['http://[::1]:4747', 'http://[::1]:4747'],
  ])('accepts %s', (input, want) => expect(parseBaseUrl(input)).toBe(want));

  it.each(['', '127.0.0.1:4747', 'ftp://host', 'http://', 'http://host?x=1', 'http://host#frag', 'http://user:pw@host', 'http://ho st'])(
    'refuses %j',
    (input) => expect(parseBaseUrl(input)).toBeNull(),
  );
});

describe('apiPath', () => {
  it('encodes each value as one path segment', () => {
    expect(apiPath`/threads/${'a/b?c d'}/uploads/${'shot #1.png'}`).toBe('/threads/a%2Fb%3Fc%20d/uploads/shot%20%231.png');
    expect(apiPath`/threads/${'t1'}/events/${42}`).toBe('/threads/t1/events/42');
  });

  it('refuses a path without a leading slash', () => {
    expect(() => apiPath`status`).toThrow(TypeError);
  });
});

describe('request', () => {
  it('sends to base/api/path with the query, the token and JSON accepted', async () => {
    const { sent, fetch } = fake();
    const http = createHttpClient({ baseUrl: parseBaseUrl('https://omni.example.com/prefix/') as BaseUrl, token: ' tok-123 ', fetch });
    await http.request('GET', apiPath`/channels/${'c 1'}/threads`, { query: { archived: '1', limit: 20, skip: undefined, q: 'a&b=c' } });
    expect(sent).toEqual([
      {
        url: 'https://omni.example.com/prefix/api/channels/c%201/threads?archived=1&limit=20&q=a%26b%3Dc',
        method: 'GET',
        headers: { accept: 'application/json', authorization: 'Bearer tok-123' },
        body: undefined,
      },
    ]);
  });

  it('passes an already encoded query string through', async () => {
    const { sent, fetch } = fake();
    await createHttpClient({ baseUrl: base, token: null, fetch }).request('GET', apiPath`/threads/${'t1'}/events`, { query: 'at=5&before=9' });
    expect(sent[0].url).toBe('http://127.0.0.1:4757/api/threads/t1/events?at=5&before=9');
  });

  it('sends no Authorization header without a token', async () => {
    for (const token of [null, '', '   ']) {
      const { sent, fetch } = fake();
      await createHttpClient({ baseUrl: base, token, fetch }).request('GET', apiPath`/auth/methods`);
      expect(sent[0].headers).toEqual({ accept: 'application/json' });
    }
  });

  it('sends a body as JSON with its content type, and no content type without one', async () => {
    const { sent, fetch } = fake();
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    await http.request('POST', apiPath`/threads/${'t1'}/messages`, { body: { prompt: 'hi', mode: 'steer' } });
    await http.request('POST', apiPath`/threads/${'t1'}/stop`);
    expect(sent[0]).toMatchObject({ method: 'POST', body: '{"prompt":"hi","mode":"steer"}' });
    expect(sent[0].headers['content-type']).toBe('application/json');
    expect(sent[1].body).toBeUndefined();
    expect(sent[1].headers).not.toHaveProperty('content-type');
  });

  it('resolves with the JSON, or what parse makes of it', async () => {
    const { fetch } = fake({ text: '{"running":2,"queued":0}' });
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    expect(await http.request('GET', apiPath`/status`)).toEqual({ running: 2, queued: 0 });
    const parsed = await http.request('GET', apiPath`/status`, { parse: (j) => (j as { running: number }).running * 10 });
    expect(parsed).toBe(20);
  });

  it('accepts a +json content type', async () => {
    const { fetch } = fake({ type: 'application/problem+json', text: '[1]' });
    expect(await createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/x`)).toEqual([1]);
  });

  it("rejects with the server's {error} and keeps the body for a refusal", async () => {
    const { fetch } = fake({ status: 409, text: '{"error":"Thread is running","code":"busy"}' });
    const f = await failure(createHttpClient({ baseUrl: base, token: 't', fetch }).request('PATCH', apiPath`/threads/${'t1'}`, { body: { done: true } }));
    expect(f).toEqual({ kind: 'http', status: 409, message: 'Thread is running', body: { error: 'Thread is running', code: 'busy' } });
  });

  it('rejects 401 as an http failure, so the caller can ask to pair again', async () => {
    const { fetch } = fake({ status: 401, text: '{"error":"Unauthorized: send this install\'s token"}' });
    const f = await failure(createHttpClient({ baseUrl: base, token: 'stale', fetch }).request('GET', apiPath`/status`));
    expect(f).toMatchObject({ kind: 'http', status: 401 });
  });

  it('uses the first 300 characters of a plain-text refusal, and the status for HTML or nothing', async () => {
    const long = 'x'.repeat(400);
    const text = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 500, type: 'text/plain', text: long }).fetch }).request('GET', apiPath`/x`));
    expect(text).toMatchObject({ kind: 'http', status: 500, message: 'x'.repeat(300) });
    const html = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 502, type: 'text/html', text: '<html>Bad gateway</html>' }).fetch }).request('GET', apiPath`/x`));
    expect(html).toMatchObject({ kind: 'http', status: 502, message: 'Request failed (502)' });
    const empty = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ status: 404, type: null, text: '' }).fetch }).request('GET', apiPath`/x`));
    expect(empty).toEqual({ kind: 'http', status: 404, message: 'Request failed (404)', body: null });
  });

  it('rejects a 2xx answer that is not JSON', async () => {
    const { fetch } = fake({ type: 'text/html', text: '<!doctype html>' });
    const err = await rejected(createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/nope`));
    expect(err.failure).toEqual({ kind: 'not-json', status: 200, contentType: 'text/html' });
    expect(err.message).toBe('The server answered 200 with text/html, not JSON.');
  });

  it('rejects malformed JSON and a shape parse refuses as decoding failures', async () => {
    const bad = await failure(createHttpClient({ baseUrl: base, token: 't', fetch: fake({ text: '{"a":' }).fetch }).request('GET', apiPath`/x`));
    expect(bad.kind).toBe('decoding');
    const refused = await failure(
      createHttpClient({ baseUrl: base, token: 't', fetch: fake({ text: '{"a":1}' }).fetch }).request('GET', apiPath`/x`, {
        parse: () => {
          throw new Error('threads is missing');
        },
      }),
    );
    expect(refused).toEqual({ kind: 'decoding', detail: 'threads is missing' });
  });

  it('rejects as unreachable when no answer comes', async () => {
    const { fetch } = fake(() => Promise.reject(new TypeError('fetch failed')));
    const err = await rejected(createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/status`));
    expect(err.failure).toEqual({ kind: 'unreachable', detail: 'fetch failed' });
    expect(err.message).toBe('Cannot reach the Omni server. Is it running?');
  });

  it('rejects as cancelled when the signal aborts', async () => {
    const abort = new AbortController();
    const fetch: Fetch = (_url, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError'))));
    const pending = createHttpClient({ baseUrl: base, token: 't', fetch }).request('GET', apiPath`/status`, { signal: abort.signal });
    abort.abort();
    expect(await failure(pending)).toEqual({ kind: 'cancelled' });
  });

  it('sends a failed write once, with no retry or queue', async () => {
    const { sent, fetch } = fake(() => Promise.reject(new TypeError('offline')));
    const http = createHttpClient({ baseUrl: base, token: 't', fetch });
    await failure(http.request('POST', apiPath`/threads`, { body: { channel: 'c', prompt: 'p' } }));
    await http.request('GET', apiPath`/status`).catch(() => {});
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual(['POST http://127.0.0.1:4757/api/threads', 'GET http://127.0.0.1:4757/api/status']);
  });

  it('builds the URL a stream or file request uses', () => {
    const http = createHttpClient({ baseUrl: base, token: 't', fetch: fake().fetch });
    expect(http.url(apiPath`/threads/${'t 1'}/stream`, { after: 7 })).toBe('http://127.0.0.1:4757/api/threads/t%201/stream?after=7');
    expect(http.url(apiPath`/feed`)).toBe('http://127.0.0.1:4757/api/feed');
  });
});
