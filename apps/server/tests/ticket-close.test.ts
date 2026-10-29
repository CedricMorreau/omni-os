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
