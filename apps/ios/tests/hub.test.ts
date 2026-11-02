import type { Fetch, SSEConnection, SSESink, SSETransport } from '@omni/client-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLiveHub, REFRESH_DEBOUNCE_MS } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';

const BASE = 'http://omni.test';
const NOW = 1_800_000_000_000;

interface Reply {
  status?: number;
  body?: unknown;
}

/** Answers each request by its path. `calls` records every path asked for, in order. */
function fakeFetch(reply: (path: string) => Reply) {
  const calls: string[] = [];
  const fetch: Fetch = async (url) => {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    calls.push(path);
    const r = reply(path);
    const text = r.body === undefined ? '' : JSON.stringify(r.body);
    return {
      status: r.status ?? 200,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => text,
    };
  };
  return { fetch, calls };
}

interface FakeConn {
  url: string;
  sink: SSESink;
  closed: boolean;
}

/** Records every stream connection the hub opens, so a test can drive each one. */
function fakeTransport() {
  const conns: FakeConn[] = [];
  const transport: SSETransport = (request, sink): SSEConnection => {
    const conn: FakeConn = { url: request.url, sink, closed: false };
    conns.push(conn);
    return {
      close() {
        conn.closed = true;
      },
    };
  };
  const feeds = () => conns.filter((c) => new URL(c.url).pathname === '/api/feed' && !c.closed);
  const threadStreams = (threadId: string) =>
    conns.filter((c) => new URL(c.url).pathname === `/api/threads/${threadId}/stream` && !c.closed);
  return { transport, conns, feeds, threadStreams };
}

const frame = (value: unknown) => ({ event: 'message', data: JSON.stringify(value) });
const channel = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, kind: 'client', archived: 0, running: 0, ...over });
const threadDetail = (over: Record<string, unknown> = {}) => ({
  thread: { id: 't1', channel_id: 'c', title: 'Fix build', status: 'running', updated_at: '', created_at: '' },
  channel: { id: 'c', name: 'Client' },
  events: [{ id: 1, thread_id: 't1', kind: 'user', payload: JSON.stringify({ text: 'hi' }), created_at: '' }],
  history: { from: 1, to: null, results_below: 0 },
  artifacts: [],
  children: [],
  parent: null,
  pending: [],
  live: false,
  ...over,
});

function session(over: Partial<OmniSession> = {}): OmniSession {
  return {
    serverUrl: BASE,
    token: async () => 'token',
    refreshAuth: async () => false,
    ...over,
  };
}

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('channel list', () => {
  it('loads the channels when the hub opens and stamps the load time', async () => {
    const { fetch, calls } = fakeFetch((path) => (path === '/api/channels' ? { body: [channel('conductor', { kind: 'system' })] } : {}));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch, now: () => NOW });
    await settle();
    expect(calls).toContain('/api/channels');
    expect(hub.channels.get()).toMatchObject({ loading: false, error: null, loadedAt: NOW });
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['conductor']);
    hub.close();
  });

  it('refetches once after a burst of thread changes, not once per message', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const before = calls.length;
    await settle(); // the feed opens on its first connection
    const [feed] = t.feeds();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'thread' }));
    feed?.sink.message(frame({ type: 'thread' }));
    feed?.sink.message(frame({ type: 'tasks' }));
    await settle(REFRESH_DEBOUNCE_MS - 1);
    expect(calls.length).toBe(before);
    await settle(1);
    expect(calls.filter((p) => p === '/api/channels')).toHaveLength(2);
    hub.close();
  });

  it('does not refetch for usage or mod lines', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const before = calls.length;
    const [feed] = t.feeds();
    feed?.sink.open();
    feed?.sink.message(frame({ type: 'usage' }));
    feed?.sink.message(frame({ type: 'mods' }));
    await settle(REFRESH_DEBOUNCE_MS * 5);
    expect(calls.length).toBe(before);
    hub.close();
  });

  it('refetches after the feed reconnects, because the feed keeps no replay', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const [first] = t.feeds();
    first?.sink.open();
    const listLoads = () => calls.filter((p) => p === '/api/channels').length;
    const afterFirstOpen = listLoads();
    first?.sink.error({});
    await settle(1_000);
    const [second] = t.feeds();
    second?.sink.open();
    await settle();
    expect(listLoads()).toBe(afterFirstOpen + 1);
    hub.close();
  });

  it('retries once with fresh credentials when a request is refused', async () => {
    let attempts = 0;
    const refreshAuth = vi.fn(async () => true);
    const { fetch, calls } = fakeFetch(() => {
      attempts += 1;
      return attempts === 1 ? { status: 401, body: { error: 'expired' } } : { body: [channel('c')] };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport: fakeTransport().transport, fetch });
    await settle();
    expect(refreshAuth).toHaveBeenCalledOnce();
    expect(calls.filter((p) => p === '/api/channels')).toHaveLength(2);
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['c']);
    hub.close();
  });

  it('runs a one-off request with the same retry, and refuses when unpaired', async () => {
    let searches = 0;
    const refreshAuth = vi.fn(async () => true);
    const { fetch } = fakeFetch((path) => {
      if (!path.startsWith('/api/search')) return { body: [] };
      searches += 1;
      return searches === 1 ? { status: 401, body: { error: 'expired' } } : { body: [{ thread_id: 't1' }] };
    });
    const hub = createLiveHub({ session: session({ refreshAuth }), transport: fakeTransport().transport, fetch });
    await settle();
    expect(await hub.call((api) => api.search('fix'))).toEqual([{ thread_id: 't1' }]);
    expect(refreshAuth).toHaveBeenCalledOnce();
    hub.close();

    const unpaired = createLiveHub({ session: session({ serverUrl: null }), transport: fakeTransport().transport, fetch });
    await expect(unpaired.call((api) => api.search('fix'))).rejects.toThrow('Not paired');
    unpaired.close();
  });

  it('keeps the last list on screen when a refetch fails', async () => {
    let fail = false;
    const { fetch } = fakeFetch(() => (fail ? { status: 500, body: { error: 'down' } } : { body: [channel('kept')] }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    await settle();
    fail = true;
    await hub.refreshChannels();
    expect(hub.channels.get()).toMatchObject({ error: 'down', loading: false });
    expect(hub.channels.get().channels?.map((c) => c.id)).toEqual(['kept']);
    hub.close();
  });
});

describe('link and background', () => {
  it('reads live once the feed is open, pauses in the background and recovers on return', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    await settle();
    const [feed] = t.feeds();
    feed?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });

    hub.setForeground(false);
    expect(hub.link.get()).toEqual({ kind: 'paused' });
    expect(t.feeds()).toHaveLength(0);

    const before = calls.length;
    hub.setForeground(true);
    await settle();
    expect(calls.length).toBeGreaterThan(before);
    t.feeds()[0]?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });
    hub.close();
  });

  it('shows Offline, retrying after the second failed attempt', async () => {
    const t = fakeTransport();
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch: fakeFetch(() => ({ body: [] })).fetch });
    await settle();
    t.feeds()[0]?.sink.error({});
    await settle(1_000);
    t.feeds()[0]?.sink.error({});
    expect(hub.link.get()).toEqual({ kind: 'reconnecting', attempt: 2 });
    hub.close();
  });

  it('stays unpaired with no server: no requests, no streams, no data', async () => {
    const t = fakeTransport();
    const { fetch, calls } = fakeFetch(() => ({ body: [] }));
    const hub = createLiveHub({ session: session({ serverUrl: null }), transport: t.transport, fetch });
    await hub.refreshChannels();
    await settle(REFRESH_DEBOUNCE_MS * 2);
    expect(hub.link.get()).toEqual({ kind: 'unpaired' });
    expect(hub.channels.get().channels).toBeNull();
    expect(calls).toEqual([]);
    expect(t.conns).toEqual([]);
    hub.close();
  });
});

describe('open thread', () => {
  it('shows the bounded history, then applies streamed rows and status changes', async () => {
    const t = fakeTransport();
    const { fetch } = fakeFetch((path) => (path.split('?')[0] === '/api/threads/t1' ? { body: threadDetail() } : { body: [] }));
    const hub = createLiveHub({ session: session(), transport: t.transport, fetch });
    const live = hub.openThread('t1');
    await settle();

    expect(live.view.get()).toMatchObject({ status: 'ready', thread: { title: 'Fix build', status: 'running' } });
    expect(live.view.get().rows.map((r) => r.id)).toEqual([1]);

    const [stream] = t.threadStreams('t1');
    expect(stream?.url).toContain('after=1');
    stream?.sink.open();
    stream?.sink.message(frame({ id: 2, thread_id: 't1', kind: 'assistant_text', payload: JSON.stringify({ text: 'hello' }), created_at: '' }));
    expect(live.view.get().rows.map((r) => r.id)).toEqual([1, 2]);

    stream?.sink.message(frame({ kind: 'thread', thread: { id: 't1', channel_id: 'c', title: 'Fix build', status: 'done' }, pending: [], live: false }));
    expect(live.view.get().thread?.status).toBe('done');
    t.feeds()[0]?.sink.open();
    expect(hub.link.get()).toEqual({ kind: 'live' });
    live.close();
    hub.close();
  });

  it('reports a thread the server does not have as missing', async () => {
    const { fetch } = fakeFetch(() => ({ status: 404, body: { error: 'not found' } }));
    const hub = createLiveHub({ session: session(), transport: fakeTransport().transport, fetch });
    const live = hub.openThread('gone');
    await settle();
    expect(live.view.get().status).toBe('missing');
    live.close();
    hub.close();
  });
});
