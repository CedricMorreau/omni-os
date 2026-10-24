import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

vi.mock('../secrets.ts', async (original) => ({
  ...await original<typeof import('../secrets.ts')>(),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];
const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };
const cursor = { harness: 'cursor', model: 'auto', effort: '' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_CURSOR_BIN: FAKE_CURSOR });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ app } = await import('../app.ts'));
}, 60_000);

afterEach(() => {
  delete process.env.FAKE_CODEX_TURN_FAIL;
  delete process.env.FAKE_CODEX_STEER_FAIL;
  delete process.env.FAKE_CODEX_STEER_COMPLETE;
  delete process.env.FAKE_CURSOR_TURN_FAIL;
  delete process.env.FAKE_CURSOR_INPUT_FAIL;
});

async function switchTo(id: string, run: object) {
  const res = await app.request(`/api/threads/${id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run),
  });
  expect(res.status).toBe(200);
}

async function source(run: object) {
  const t = await H.start('remember the word PAPAYA', claude);
  await H.untilResults(t.id, 1);
  await switchTo(t.id, run);
  return t;
}

function unread(id: string) {
  expect(H.db.threads.sessionState(id).handover).not.toBeNull();
  expect(H.byKind(id, 'handover')).toEqual([]);
  expect(H.byKind(id, 'user').at(-1)!.p).toMatchObject({ text: 'what word?', dropped: true });
}

function delivered(id: string) {
  expect(H.db.threads.sessionState(id).handover).toBeNull();
  expect(H.byKind(id, 'handover')).toHaveLength(1);
  expect(H.byKind(id, 'user').at(-1)!.p).toMatchObject({ text: 'try again' });
  expect(H.byKind(id, 'user').at(-1)!.p.dropped).toBeUndefined();
}

describe('handover delivery acknowledgement', () => {
  it('retains a rejected Codex turn handover and retries it on the existing session', async () => {
    const t = await source(codex);
    process.env.FAKE_CODEX_TURN_FAIL = '1';
    H.runner.sendMessage(t.id, 'what word?');
    await H.untilStatus(t.id, 'failed');
    unread(t.id);
    const session = H.thread(t.id).session_id;
    expect(session).toMatch(/^th_/);

    delete process.env.FAKE_CODEX_TURN_FAIL;
    H.runner.sendMessage(t.id, 'try again');
    await H.untilResults(t.id, 2);
    delivered(t.id);
    expect(H.thread(t.id).session_id).toBe(session);
    const inputs = H.codexRequests().filter((r) => r.thread_id === t.id && r.method === 'turn/start');
    expect(inputs).toHaveLength(2);
    for (const r of inputs) expect(r.params.input[0].text).toContain('[the user] remember the word PAPAYA');
    expect(inputs[1].params.input[0].text).toMatch(/^<omni-handover>/);
    expect(inputs[1].params.input[0].text.endsWith('try again')).toBe(true);
  });

  for (const failure of ['FAKE_CURSOR_TURN_FAIL', 'FAKE_CURSOR_INPUT_FAIL']) {
    it(`retains Cursor's handover when ${failure} rejects input, then retries it`, async () => {
      const t = await source(cursor);
      process.env[failure] = '1';
      H.runner.sendMessage(t.id, 'what word?');
      await H.untilStatus(t.id, 'failed');
      unread(t.id);
      const session = H.thread(t.id).session_id;
      expect(session).toMatch(/^chat_/);

      delete process.env[failure];
      H.runner.sendMessage(t.id, 'try again');
      await H.untilResults(t.id, 2);
      delivered(t.id);
      expect(H.thread(t.id).session_id).toBe(session);
      const inputs = H.cursorRequests().filter((r) => r.thread_id === t.id && r.method === 'turn');
      expect(inputs).toHaveLength(2);
      for (const r of inputs) expect(r.prompt).toContain('[the user] remember the word PAPAYA');
      expect(inputs[1].prompt).toContain('Omni OS');
      expect(inputs[1].prompt.endsWith('try again')).toBe(true);
    });
  }

  it('acknowledges a rejected Codex steer only when its fallback turn accepts it', async () => {
    process.env.FAKE_CODEX_STEER_FAIL = '1';
    const t = await H.start('SLOW original task', codex);
    await H.until('Codex turn started', () => H.byKind(t.id, 'init').length > 0);
    delete process.env.FAKE_CODEX_STEER_FAIL;
    H.runner.sendMessage(t.id, 'adjust course', { mode: 'steer' });
    await H.until('steer request', () => H.codexRequests().some((r) => r.thread_id === t.id && r.method === 'turn/steer'));
    expect(H.texts(t.id, 'user')).toEqual(['SLOW original task']);

    await H.untilResults(t.id, 2);
    expect(H.texts(t.id, 'user')).toEqual(['SLOW original task', 'adjust course']);
    expect(H.codexRequests().filter((r) => r.thread_id === t.id && r.method === 'turn/start')).toHaveLength(2);
    expect(H.byKind(t.id, 'user').every((e) => !e.p.dropped)).toBe(true);
  });

  it('finishes when Codex accepts a steer and completes in the same stdout batch', async () => {
    process.env.FAKE_CODEX_STEER_COMPLETE = '1';
    const t = await H.start('SLOW original task', codex);
    await H.until('Codex turn started', () => H.byKind(t.id, 'init').length > 0);
    delete process.env.FAKE_CODEX_STEER_COMPLETE;
    H.runner.sendMessage(t.id, 'finish now', { mode: 'steer' });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).status).toBe('done');
    expect(H.texts(t.id, 'user')).toEqual(['SLOW original task', 'finish now']);
    const result = H.byKind(t.id, 'result')[0];
    expect(H.byKind(t.id, 'user').at(-1)!.id).toBeLessThan(result.id);
  });
});
