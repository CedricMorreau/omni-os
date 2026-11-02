import type { Fetch, SSEConnection, SSETransport } from '@omni/client-core';
import { describe, expect, it, vi } from 'vitest';

import { createLiveHub } from '../src/live/hub';
import type { OmniSession } from '../src/live/session';
import { composerPlaceholder, sendLabel, sendModeFor } from '../src/send/rules';

const BASE = 'http://omni.test';

interface Sent {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

type Reply = { status?: number; body?: unknown } | 'drop';

/** Answers by `METHOD path`. A reply of 'drop' fails the way a lost connection does. */
function server(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>) {
  const sent: Sent[] = [];
  const fetch: Fetch = async (url, init) => {
    const { pathname } = new URL(url);
    const req: Sent = { method: init.method, path: pathname, body: init.body ? JSON.parse(init.body) : null };
    sent.push(req);
    const reply = (await replies(req)) ?? { body: {} };
    if (reply === 'drop') throw new TypeError('Network request failed');
    return {
      status: reply.status ?? 200,
      headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  return { fetch, sent, posts: () => sent.filter((s) => s.method === 'POST') };
}

const transport: SSETransport = (): SSEConnection => ({ close() {} });

const thread = (over: Record<string, unknown> = {}) => ({ id: 't1', channel_id: 'c', title: 'Fix build', status: 'idle', harness: 'claude-code', queued_harness: null, setup: null, updated_at: '', created_at: '', ...over });
const detail = (t = thread(), pending: unknown[] = []) => ({
  thread: t,
  channel: { id: 'c', name: 'Client' },
  events: [],
  history: { from: 1, to: null, results_below: 0 },
  artifacts: [],
  children: [],
  parent: null,
  pending,
  live: false,
});
const accepted = (id: string, t = thread({ status: 'running' })) => ({ ...t, request: { id: 'm1', request_id: id, state: 'accepted', accepted_at: '' } });
const harnesses = [
  { id: 'claude-code', capabilities: { steer: true } },
  { id: 'cursor', capabilities: { steer: false } },
];

function open(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>, over: Partial<OmniSession> = {}) {
  const s = server((req) => {
    if (req.method === 'GET' && req.path === '/api/harnesses') return { body: harnesses };
    if (req.method === 'GET' && req.path === '/api/threads/t1') return { body: detail() };
    if (req.method === 'GET') return { body: [] };
    return replies(req);
  });
  const session: OmniSession = { serverUrl: BASE, token: async () => 'token', refreshAuth: async () => false, ...over };
  const hub = createLiveHub({ session, transport, fetch: s.fetch });
  return { ...s, hub };
}

async function opened(replies: (req: Sent) => Reply | undefined | Promise<Reply | undefined>, over: Partial<OmniSession> = {}) {
  const o = open(replies, over);
  const live = o.hub.openThread('t1');
  await vi.waitFor(() => expect(live.view.get().status).toBe('ready'));
  await vi.waitFor(() => expect(live.catalog.get()).not.toBeNull());
  return { ...o, live };
}

describe('sending to an idle thread', () => {
  it('posts the trimmed text with a request id and no mode, and shows the thread it answers with', async () => {
    const { live, posts, hub } = await opened(() => ({ body: accepted('whatever') }));
    await live.send.submit(live.view.get().thread!, '  run the tests  ');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/messages' });
    expect(posts()[0].body).toEqual({ prompt: 'run the tests', request_id: expect.any(String) });
    expect(live.send.state.get().outbox.item).toBeNull();
    expect(live.view.get().thread?.status).toBe('running');
    hub.close();
  });

  it('does nothing for an empty box', async () => {
    const { live, posts, hub } = await opened(() => ({ body: accepted('x') }));
    expect(await live.send.submit(live.view.get().thread!, '   ')).toBeNull();
    expect(posts()).toHaveLength(0);
    hub.close();
  });

  it('sends a double tap once', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { live, posts, hub } = await opened(async (req) => {
      if (req.method !== 'POST') return undefined;
      await gate;
      return { body: accepted('x') };
    });
    const t = live.view.get().thread!;
    const first = live.send.submit(t, 'once');
    const second = live.send.submit(t, 'once');
    release();
    await Promise.all([first, second]);
    expect(posts()).toHaveLength(1);
    hub.close();
  });
});

describe('steer or queue while a turn runs', () => {
  it('steers a running thread on a harness that can', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { body: accepted('x') } : undefined));
    await live.send.submit(thread({ status: 'running' }) as never, 'also check lint');
    expect(posts()[0].body).toMatchObject({ prompt: 'also check lint', mode: 'steer' });
    hub.close();
  });

  it('queues on a harness that cannot steer, and when a run switch waits behind the turn', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { body: accepted('x') } : undefined));
    await live.send.submit(thread({ status: 'running', harness: 'cursor' }) as never, 'one');
    await live.send.submit(thread({ status: 'queued', queued_harness: 'codex' }) as never, 'two');
    expect(posts().map((p) => p.body?.mode)).toEqual(['queue', 'queue']);
    hub.close();
  });

  it('decides from what the harness catalog says, not only the harness name', () => {
    const t = thread({ status: 'running', harness: 'cursor' }) as never;
    expect(sendModeFor(t, null)).toBe('queue');
    expect(sendModeFor(t, [{ id: 'cursor', capabilities: { steer: true } }] as never)).toBe('steer');
    expect(sendModeFor(thread({ status: 'done' }) as never, null)).toBeUndefined();
  });

  it('words the composer for what Send will do', () => {
    const running = thread({ status: 'running' }) as never;
    const cursor = thread({ status: 'running', harness: 'cursor' }) as never;
    expect(composerPlaceholder(thread() as never, null)).toBe('Follow up');
    expect(composerPlaceholder(running, null)).toBe('Steer the agent');
    expect(composerPlaceholder(cursor, null)).toBe('Queue for after this turn');
    expect(sendLabel(running, null)).toBe('Send to the running turn');
    expect(sendLabel(cursor, null)).toBe('Send after this turn');
  });
});

describe('a dropped connection', () => {
  it('keeps the message, retries under the same request id and sends it once', async () => {
    let drops = 2;
    const { live, posts, hub } = await opened((req) => {
      if (req.method !== 'POST') return undefined;
      return drops-- > 0 ? 'drop' : { body: { ...accepted('x'), request: { ...accepted('x').request, duplicate: true } } };
    });
    const t = live.view.get().thread!;
    expect(await live.send.submit(t, 'deploy it')).toBeNull();
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', text: 'deploy it', failure: { kind: 'offline' } });

    expect(await live.send.retry()).toBeNull();
    expect(live.send.state.get().outbox.item?.phase).toBe('failed');

    expect(await live.send.retry()).not.toBeNull();
    expect(live.send.state.get().outbox.item).toBeNull();

    const ids = posts().map((p) => p.body?.request_id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    expect(posts().map((p) => p.body?.prompt)).toEqual(['deploy it', 'deploy it', 'deploy it']);
    hub.close();
  });

  it('keeps the mode through the retry even when the thread went idle meanwhile', async () => {
    let drop = true;
    const { live, posts, hub } = await opened((req) => {
      if (req.method !== 'POST') return undefined;
      if (drop) {
        drop = false;
        return 'drop';
      }
      return { body: accepted('x') };
    });
    await live.send.submit(thread({ status: 'running' }) as never, 'steer me');
    await live.send.retry();
    expect(posts().map((p) => p.body?.mode)).toEqual(['steer', 'steer']);
    hub.close();
  });

  it('holds a second message back until the failed one is retried or taken out', async () => {
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? 'drop' : undefined));
    const t = live.view.get().thread!;
    await live.send.submit(t, 'first');
    expect(await live.send.submit(t, 'second')).toBeNull();
    expect(posts()).toHaveLength(1);
    expect(live.send.edit()).toBe('first');
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });
});

describe('errors', () => {
  it("shows the server's own words for a refused send, and a retry is allowed", async () => {
    const { live, hub } = await opened((req) => (req.method === 'POST' ? { status: 409, body: { error: 'This thread runs on your other Mac.' } } : undefined));
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(live.send.state.get().outbox.item).toMatchObject({ phase: 'failed', failure: { kind: 'refused', message: 'This thread runs on your other Mac.' } });
    hub.close();
  });

  it('reports a server error as one', async () => {
    const { live, hub } = await opened((req) => (req.method === 'POST' ? { status: 500, body: { error: 'database is locked' } } : undefined));
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(live.send.state.get().outbox.item).toMatchObject({ failure: { kind: 'server', message: 'database is locked', ambiguous: true } });
    hub.close();
  });

  it('asks the session about a 401 and, when it says the phone was revoked, ends in signed-out with nothing to retry', async () => {
    const refreshAuth = vi.fn(async () => false);
    const { live, posts, hub } = await opened((req) => (req.method === 'POST' ? { status: 401, body: { error: 'unauthorized' } } : undefined), { refreshAuth });
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(refreshAuth).toHaveBeenCalled();
    expect(live.send.state.get().outbox.item).toMatchObject({ failure: { kind: 'signed-out' } });
    expect(await live.send.retry()).toBeNull();
    expect(posts()).toHaveLength(1);
    hub.close();
  });

  it('sends again with fresh credentials when the session refreshed after a 401', async () => {
    const refreshAuth = vi.fn(async () => true);
    let first = true;
    const { live, posts, hub } = await opened(
      (req) => {
        if (req.method !== 'POST') return undefined;
        if (first) {
          first = false;
          return { status: 401, body: { error: 'expired' } };
        }
        return { body: accepted('x') };
      },
      { refreshAuth },
    );
    await live.send.submit(live.view.get().thread!, 'hi');
    expect(posts().map((p) => p.body?.request_id)).toHaveLength(2);
    expect(new Set(posts().map((p) => p.body?.request_id)).size).toBe(1);
    expect(live.send.state.get().outbox.item).toBeNull();
    hub.close();
  });
});

describe('stop', () => {
  it('stops the running turn and shows the thread it answers with', async () => {
    const { live, posts, hub } = await opened((req) => (req.path.endsWith('/stop') ? { body: thread({ status: 'idle' }) } : undefined));
    await live.send.stop();
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/stop' });
    expect(live.view.get().thread?.status).toBe('idle');
    expect(live.send.state.get()).toMatchObject({ stopping: false, notice: null });
    hub.close();
  });

  it('says why a stop failed and lets Ben try again', async () => {
    const { live, hub } = await opened((req) => (req.path.endsWith('/stop') ? 'drop' : undefined));
    await live.send.stop();
    expect(live.send.state.get()).toMatchObject({ stopping: false, notice: expect.stringMatching(/Cannot reach/) });
    hub.close();
  });
});

describe('held messages', () => {
  const held = { uuid: 'u1', kind: 'user', text: 'did this land?', mode: 'steer', state: 'sent', delivery: 'uncertain', request_id: 'r1' };

  it('sends one again by naming it, and shows the pending list it answers with', async () => {
    const { live, posts, hub } = await opened((req) => (req.path.endsWith('/requests/resume') ? { body: { thread: thread({ status: 'running' }), pending: [] } } : undefined));
    await live.send.resume(held.uuid);
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/requests/resume', body: { ids: ['u1'] } });
    expect(live.view.get()).toMatchObject({ pending: [], thread: { status: 'running' } });
    hub.close();
  });

  it('discards one and shows what is left', async () => {
    const left = { ...held, uuid: 'u2' };
    const { live, posts, hub } = await opened((req) => (req.path.endsWith('/requests/discard') ? { body: { thread: thread(), pending: [left] } } : undefined));
    await live.send.discard(held.uuid);
    expect(posts()[0]).toMatchObject({ path: '/api/threads/t1/requests/discard', body: { ids: ['u1'] } });
    expect(live.view.get().pending.map((p) => p.uuid)).toEqual(['u2']);
    hub.close();
  });

  it('keeps the list and says why when the server refuses', async () => {
    const { live, hub } = await opened((req) => (req.path.endsWith('/requests/resume') ? { status: 409, body: { error: 'Some of these messages are no longer waiting to be resumed.' } } : undefined));
    await live.send.resume(held.uuid);
    expect(live.send.state.get()).toMatchObject({ heldBusy: null, notice: 'Some of these messages are no longer waiting to be resumed.' });
    hub.close();
  });
});
