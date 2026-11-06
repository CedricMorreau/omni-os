import { beforeAll, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
let buildSystemPrompt: Awaited<typeof import('../runner/prompts.ts')>['buildSystemPrompt'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  ({ buildSystemPrompt } = await import('../runner/prompts.ts'));
  H.db.channels.create({ id: 'acme', name: 'Acme', kind: 'client', use_worktree: 0, base_dir: H.tmp });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};

const settled = (id: string) => H.until(`thread ${id} to settle`, () => !['running', 'queued'].includes(H.thread(id).status) && H.thread(id));

it('keeps a message draft on a thread without a ticket', async () => {
  const t = await H.start('THINK:1');
  await H.untilResults(t.id, 1);
  expect((await call('POST', `/threads/${t.id}/draft`, { text: 'Hi Acme, the fix is live.' })).status).toBe(200);
  expect((await call('GET', `/threads/${t.id}`)).body.thread).toMatchObject({ draft: 'Hi Acme, the fix is live.', draft_kind: 'message' });
});

it('puts the message draft on the ticket in a ticket thread', async () => {
  const made = await call('POST', '/tickets', { channel: 'acme', source: 'local', context: 'tiny fix' });
  const id = made.body.thread_id;
  await settled(id);
  expect((await call('POST', `/threads/${id}/draft`, { text: 'Hi Acme, a check before go-live.' })).status).toBe(200);
  expect((await call('GET', `/tickets/${id}`)).body.draft).toEqual({ kind: 'message', text: 'Hi Acme, a check before go-live.' });
  expect(H.thread(id).draft).toBeNull();
});

it('tells a local thread to put every client message in a draft', async () => {
  const t = await H.start('THINK:1');
  await H.untilResults(t.id, 1);
  const prompt = buildSystemPrompt(H.thread(t.id), H.db.channels.get('scratch')!);
  expect(prompt).toContain('draft_message');
});
