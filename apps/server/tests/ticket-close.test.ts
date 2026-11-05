import { beforeAll, describe, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  H.db.channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0, base_dir: H.tmp });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};

const settled = (id: string) => H.until(`thread ${id} to settle`, () => !['running', 'queued'].includes(H.thread(id).status) && H.thread(id));

describe('closing a ticket', () => {
  it('closes from the Close button and hands the memory chores to the ticket thread', async () => {
    const made = await call('POST', '/tickets', { channel: 'acme', source: 'local', context: 'tiny fix' });
    const id = made.body.thread_id;
    await settled(id);
    await call('POST', `/tickets/${id}/route`, { stages: [10] });
    const closed = await call('POST', `/tickets/${id}/close`, { by: 'user' });
    expect(closed.status).toBe(200);
    expect(closed.body.closed_at).not.toBeNull();
    expect(closed.body.next).toBeUndefined();
    await H.until('the chores message', () => H.byKind(id, 'user').some((e) => String(e.p.text).includes('The user closed this ticket')));
  });

  it('closes for the agent and returns the chores instead of sending them', async () => {
    const made = await call('POST', '/tickets', { channel: 'acme', source: 'local', context: 'tiny fix' });
    const id = made.body.thread_id;
    await settled(id);
    await call('POST', `/tickets/${id}/route`, { stages: [10] });
    const closed = await call('POST', `/tickets/${id}/close`, {});
    expect(closed.body.next).toContain('ticket_archive');
    expect(H.byKind(id, 'user').some((e) => String(e.p.text).includes('The user closed this ticket'))).toBe(false);
  });
});

describe('a ticket from the channel composer', () => {
  it('makes a ticket when a client channel thread starts with the ticket role, with the link from the prompt', async () => {
    const made = await call('POST', '/threads', { channel: 'acme', role: 'ticket', prompt: 'please pick up https://app.productive.io/1/projects/2/tasks/task/555' });
    expect(made.status).toBe(200);
    const ticket = await call('GET', `/tickets/${made.body.id}`);
    expect(ticket.body).toMatchObject({ ref: '#555', source: 'productive', stage: 0 });
  });

  it('makes one ticket when the client retries a create with the same id', async () => {
    const id = '00000000-0000-4000-8000-00000000a001';
    const body = { id, channel: 'acme', role: 'ticket', prompt: 'fix the Globex footer' };
    const [first, second] = await Promise.all([call('POST', '/threads', body), call('POST', '/threads', body)]);
    const third = await call('POST', '/threads', body);
    expect([first.body.id, second.body.id, third.body.id]).toEqual([id, id, id]);
    expect((await call('GET', `/tickets/${id}`)).status).toBe(200);
    const { tickets } = await import('../tickets.ts');
    expect(tickets.all().filter((t) => t.context === 'fix the Globex footer')).toHaveLength(1);
  });

  it('keeps a thread without the ticket role a plain thread', async () => {
    const made = await call('POST', '/threads', { channel: 'acme', prompt: 'quick question' });
    expect((await call('GET', `/tickets/${made.body.id}`)).status).toBe(404);
  });
});
