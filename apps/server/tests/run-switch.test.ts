import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Runner regressions use fake CLIs and isolated state, with no access to the Mac's Keychain.
vi.mock('../secrets.ts', async (original) => ({
  ...await original<typeof import('../secrets.ts')>(),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));


// Switching a thread's run between turns, through POST /api/threads/:id/run and the real runner, against the fake
// claude and codex CLIs.
let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex']);
  ({ app } = await import('../app.ts'));
});

const switchTo = (id: string, run: object) =>
  app.request(`/api/threads/${id}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(run) });

const kinds = (id: string) => H.events(id).map((e) => e.kind);
const codexInputs = (id: string): string[] =>
  H.codexRequests()
    .filter((r) => r.method === 'turn/start' && r.thread_id === id)
    .map((r) => r.params.input[0].text);

describe('switching the run between turns', () => {
  it('resumes the same session with the new effort on the same harness', async () => {
    const t = await H.start('first', claude);
    await H.untilResults(t.id, 1);
    const res = await switchTo(t.id, { ...claude, effort: 'low' });
    expect(res.status).toBe(200);
    expect((await res.json()).effort).toBe('low');

    H.runner.sendMessage(t.id, 'second');
    await H.untilResults(t.id, 2);
    const [before, after] = H.spawns(t.id);
    expect(after).toMatchObject({ effort: 'low', resume: true, session_id: before.session_id });
    expect(H.byKind(t.id, 'switch').map((e) => e.p.mode)).toEqual(['settings']);
    expect(kinds(t.id)).not.toContain('handover');
  });

  it('hands a Claude thread to Codex, and back to Claude with only what it missed', async () => {
    const t = await H.start('remember the word PAPAYA', claude);
    await H.untilResults(t.id, 1);
    const claudeSession = H.thread(t.id).session_id;

    expect((await switchTo(t.id, codex)).status).toBe(200);
    expect(H.db.threads.sessionState(t.id).handover).toMatchObject({ since: 0 });
    H.runner.sendMessage(t.id, 'what word?');
    await H.untilResults(t.id, 2);

    const [input] = codexInputs(t.id);
    expect(input.startsWith('<omni-handover>')).toBe(true);
    expect(input).toContain('[the user] remember the word PAPAYA');
    expect(input.endsWith('what word?')).toBe(true);
    // The transcript keeps only what was typed, and says the handover happened after the switch.
    expect(H.texts(t.id, 'user')).toEqual(['remember the word PAPAYA', 'what word?']);
    expect(kinds(t.id).indexOf('switch')).toBeLessThan(kinds(t.id).indexOf('handover'));
    expect(H.byKind(t.id, 'handover')[0].p).toMatchObject({ session: 'fresh', to: { harness: 'codex', harnessName: 'Codex' }, omitted: 0 });
    expect(H.db.threads.sessionState(t.id)).toEqual({ sessions: { 'claude-code': { id: claudeSession, seen: expect.any(Number) } }, handover: null });
    expect(H.thread(t.id).session_id).toMatch(/^th_/);
    // Synced as the event's uid, so a switch back on the other Mac reads the same place in the transcript.
    const seen = H.db.threads.sessionState(t.id).sessions['claude-code']!.seen;
    expect(H.db.threads.storedSessionState(t.id).sessions!['claude-code']!.seen).toBe(H.db.events.uidOf(seen));

    expect((await switchTo(t.id, claude)).status).toBe(200);
    H.runner.sendMessage(t.id, 'and now?');
    await H.untilResults(t.id, 3);
    const back = H.spawns(t.id).at(-1);
    expect(back).toMatchObject({ resume: true, session_id: claudeSession });
    const delta = H.claudeTexts(t.id).at(-1)!;
    expect(delta).toContain('You ran this thread earlier. While it ran on Codex');
    expect(delta).toContain('[the user] what word?');
    // It starts where Claude left off: the switch away, not the thread's first message.
    expect(delta.split('History, oldest first:\n')[1].startsWith('[Omni] Handing over from Claude Code')).toBe(true);
    expect(delta.endsWith('and now?')).toBe(true);
    expect(H.byKind(t.id, 'handover').at(-1)!.p).toMatchObject({ session: 'resumed', to: { harness: 'claude-code' } });
    expect(H.db.threads.sessionState(t.id).handover).toBeNull();
  });

  it('runs a command first and hands over with the next plain message', async () => {
    const t = await H.start('remember the word GUAVA', codex);
    await H.untilResults(t.id, 1);
    expect((await switchTo(t.id, claude)).status).toBe(200);

    await H.runner.postMessage(t.id, '/tdd fix the parser');
    await H.untilResults(t.id, 2);
    expect(H.claudeTexts(t.id).at(-1)).toBe('/tdd fix the parser');
    expect(kinds(t.id)).not.toContain('handover');
    expect(H.db.threads.sessionState(t.id).handover).toMatchObject({ since: 0, started: true });
    const session = H.thread(t.id).session_id;

    await H.runner.postMessage(t.id, 'what word?');
    await H.untilResults(t.id, 3);
    const text = H.claudeTexts(t.id).at(-1)!;
    expect(text.startsWith('<omni-handover>')).toBe(true);
    expect(text).toContain('[the user] remember the word GUAVA');
    expect(text).toContain('[the user] /tdd fix the parser');
    expect(text.endsWith('what word?')).toBe(true);
    expect(H.thread(t.id).session_id).toBe(session);
    expect(H.byKind(t.id, 'handover')[0].p).toMatchObject({ session: 'fresh', to: { harness: 'claude-code' } });
    expect(H.texts(t.id, 'user').at(-1)).toBe('what word?');
    expect(H.db.threads.sessionState(t.id).handover).toBeNull();
  });

  it('refuses an effort the model does not have, and leaves the run as it was', async () => {
    const t = await H.start('hello', claude);
    await H.untilResults(t.id, 1);
    const res = await switchTo(t.id, { ...claude, effort: 'ultra' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('does not support effort');
    expect(H.thread(t.id).effort).toBe('high');
    expect(kinds(t.id)).not.toContain('switch');
  });
});

const queued = (id: string) => {
  const t = H.thread(id);
  return t.queued_harness ? { harness: t.queued_harness, model: t.queued_model, effort: t.queued_effort } : null;
};

describe('a switch picked during a turn', () => {
  it('waits for the turn, then switches the effort', async () => {
    const t = await H.start('TOOL:600 a long one', claude);
    await H.untilTool(t.id);
    const res = await switchTo(t.id, { ...claude, effort: 'low' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ effort: 'high', queued_harness: 'claude-code', queued_effort: 'low' });
    expect(kinds(t.id)).not.toContain('switch');

    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).effort).toBe('low');
    expect(queued(t.id)).toBeNull();
    // The switch row follows the turn it waited for.
    expect(kinds(t.id).indexOf('result')).toBeLessThan(kinds(t.id).indexOf('switch'));
    H.runner.sendMessage(t.id, 'second');
    await H.untilResults(t.id, 2);
    const [before, after] = H.spawns(t.id);
    expect(after).toMatchObject({ effort: 'low', resume: true, session_id: before.session_id });
  });

  it('waits for the turn, then switches the model', async () => {
    const t = await H.start('TOOL:600 a long one', claude);
    await H.untilTool(t.id);
    expect((await switchTo(t.id, { ...claude, model: 'claude-opus-5-5', effort: '' })).status).toBe(200);
    expect(H.thread(t.id).model).toBe('sonnet');
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ model: 'claude-opus-5-5', effort: '', queued_harness: null });
    expect(H.byKind(t.id, 'switch').map((e) => e.p.mode)).toEqual(['settings']);
  });

  it('hands over to another harness once the turn ends', async () => {
    const t = await H.start('TOOL:600 remember the word MANGO', claude);
    await H.untilTool(t.id);
    expect((await switchTo(t.id, codex)).status).toBe(200);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).harness).toBe('codex');
    expect(H.byKind(t.id, 'switch')[0].p).toMatchObject({ mode: 'handover', from: { harness: 'claude-code' }, to: { harness: 'codex' } });
    expect(H.db.threads.sessionState(t.id).handover).toMatchObject({ since: 0 });

    H.runner.sendMessage(t.id, 'what word?');
    await H.untilResults(t.id, 2);
    const [input] = codexInputs(t.id);
    expect(input.startsWith('<omni-handover>')).toBe(true);
    expect(input).toContain('MANGO');
    expect(input.endsWith('what word?')).toBe(true);
    expect(H.byKind(t.id, 'handover')[0].p).toMatchObject({ session: 'fresh', to: { harness: 'codex' } });
  });

  it('runs a message sent behind the turn on the new run', async () => {
    const t = await H.start('TOOL:600 remember the word KIWI', claude);
    await H.untilTool(t.id);
    expect((await switchTo(t.id, codex)).status).toBe(200);
    // Sent as a steer, it would join this turn. With a switch waiting it waits for the turn instead.
    H.runner.sendMessage(t.id, 'what word?');
    expect(H.runner.pendingFor(t.id).map((m) => m.state)).toEqual(['held']);
    await H.untilResults(t.id, 2);

    expect(H.claudeTexts(t.id)).toEqual(['TOOL:600 remember the word KIWI']);
    const [input] = codexInputs(t.id);
    expect(input.startsWith('<omni-handover>')).toBe(true);
    expect(input.endsWith('what word?')).toBe(true);
    expect(H.texts(t.id, 'user')).toEqual(['TOOL:600 remember the word KIWI', 'what word?']);
    // One result per run: the switch sits between them, and the thread waited, queued, for the new process.
    expect(kinds(t.id).filter((k) => ['result', 'switch', 'handover'].includes(k))).toEqual(['result', 'switch', 'handover', 'result']);
    expect(H.statuses(t.id)).toContain('queued');
    expect(H.thread(t.id).status).toBe('done');
  });

  it('takes a later pick over the queued one, and drops it when the current run is picked', async () => {
    const t = await H.start('TOOL:800 a long one', claude);
    await H.untilTool(t.id);
    await switchTo(t.id, codex);
    expect(queued(t.id)).toEqual({ harness: 'codex', model: '', effort: '' });
    await switchTo(t.id, { ...claude, effort: 'low' });
    expect(queued(t.id)).toEqual({ harness: 'claude-code', model: 'sonnet', effort: 'low' });
    const res = await switchTo(t.id, claude);
    expect(res.status).toBe(200);
    expect((await res.json()).queued_harness).toBeNull();

    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ harness: 'claude-code', effort: 'high' });
    expect(kinds(t.id)).not.toContain('switch');
  });

  it('switches after a turn that failed', async () => {
    const t = await H.start('LIMIT THINK:600 a turn the limit stops', claude);
    await H.until('the turn running', () => H.thread(t.id).status === 'running' && H.spawns(t.id).length > 0);
    expect((await switchTo(t.id, { ...claude, effort: 'low' })).status).toBe(200);
    expect(queued(t.id)).not.toBeNull();
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ status: 'failed', effort: 'low', queued_harness: null });
    expect(H.byKind(t.id, 'switch')).toHaveLength(1);
  });

  it('switches after Ben stops the turn', async () => {
    const t = await H.start('TOOL:3000 a long one', claude);
    await H.untilTool(t.id);
    expect((await switchTo(t.id, codex)).status).toBe(200);
    H.runner.interruptThread(t.id);
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id)).toMatchObject({ status: 'stopped', harness: 'codex', queued_harness: null });
    expect(H.byKind(t.id, 'switch')[0].p.mode).toBe('handover');
  });

  it('refuses a pick the catalog does not have at once, and keeps the one queued', async () => {
    const t = await H.start('TOOL:600 a long one', claude);
    await H.untilTool(t.id);
    await switchTo(t.id, { ...claude, effort: 'low' });
    const res = await switchTo(t.id, { ...claude, effort: 'ultra' });
    expect(res.status).toBe(400);
    expect(queued(t.id)).toMatchObject({ effort: 'low' });
    await H.untilResults(t.id, 1);
    expect(H.thread(t.id).effort).toBe('low');
  });
});
