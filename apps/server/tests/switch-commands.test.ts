import { beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';

// Runner regressions use fake CLIs and isolated state, with no access to the Mac's Keychain.
vi.mock('../secrets.ts', async (original) => ({
  ...await original<typeof import('../secrets.ts')>(),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));


let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex']);
  ({ app } = await import('../app.ts'));
});

async function switchToCodex(id: string) {
  const response = await app.request(`/api/threads/${id}/run`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ harness: 'codex', model: '', effort: '' }),
  });
  expect(response.status).toBe(200);
}

describe('commands immediately after a harness switch', () => {
  it('runs Codex review first, then hands over with the next plain message', async () => {
    const t = await H.start('Remember PAPAYA', { harness: 'claude-code', model: 'sonnet' });
    await H.untilResults(t.id, 1);
    await switchToCodex(t.id);
    await H.runner.postMessage(t.id, '/review look for mistakes');
    await H.untilResults(t.id, 2);

    const requests = H.codexRequests().filter((r) => r.thread_id === t.id);
    expect(requests.some((r) => r.method === 'review/start')).toBe(true);
    expect(requests.some((r) => r.method === 'turn/start')).toBe(false);
    expect(H.byKind(t.id, 'handover')).toHaveLength(0);
    expect(H.db.threads.sessionState(t.id).handover).not.toBeNull();

    await H.runner.postMessage(t.id, 'What word did I ask you to remember?');
    await H.untilResults(t.id, 3);
    const turn = H.codexRequests().find((r) => r.thread_id === t.id && r.method === 'turn/start');
    expect(turn.params.input[0].text).toContain('<omni-handover>');
    expect(turn.params.input[0].text).toContain('PAPAYA');
    expect(H.byKind(t.id, 'handover')).toHaveLength(1);
  });

  it('loads a destination skill file instead of reusing the old harness command', async () => {
    const t = await H.start('First turn', { harness: 'claude-code', model: 'sonnet' });
    await H.untilResults(t.id, 1);
    await switchToCodex(t.id);
    await H.runner.postMessage(t.id, '/tdd fix the parser');
    await H.untilResults(t.id, 2);

    const turn = H.codexRequests().find((r) => r.thread_id === t.id && r.method === 'turn/start');
    expect(turn.params.input).toContainEqual({ type: 'skill', name: 'tdd', path: '/Users/dev/.agents/skills/tdd/SKILL.md' });
    expect(turn.params.input[0].text).toBe('$tdd fix the parser');
    expect(H.byKind(t.id, 'handover')).toHaveLength(0);
  });
});
