import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX, FAKE_CURSOR } from './support.ts';

// Runner regressions use fake CLIs and isolated state, with no access to the Mac's Keychain.
vi.mock('../secrets.ts', async (original) => ({
  ...await original<typeof import('../secrets.ts')>(),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));


let H: Awaited<ReturnType<typeof startRunner>>;
let switchRun: typeof import('../runner/switch.ts')['switchRun'];
let closeLive: typeof import('../runner/session.ts')['closeLive'];
let lives: typeof import('../runner/state.ts')['lives'];

const claude = { harness: 'claude-code', model: 'sonnet', effort: 'high' };
const codex = { harness: 'codex', model: '', effort: '' };
const cursor = { harness: 'cursor', model: 'composer-2.5', effort: '' };
const failures = ['FAKE_CLAUDE_INIT_FAIL', 'FAKE_CODEX_START_FAIL', 'FAKE_CURSOR_START_FAIL'];

beforeAll(async () => {
  H = await startRunner({
    OMNI_CODEX_BIN: FAKE_CODEX,
    OMNI_CURSOR_BIN: FAKE_CURSOR,
    ...Object.fromEntries(failures.map((key) => [key, '0'])),
  });
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex', 'cursor']);
  ({ switchRun } = await import('../runner/switch.ts'));
  ({ closeLive } = await import('../runner/session.ts'));
  ({ lives } = await import('../runner/state.ts'));
}, 30_000);

afterEach(() => {
  for (const key of failures) process.env[key] = '0';
});

const cases = [
  { name: 'Codex', run: codex, source: claude, command: '/review', failure: 'FAKE_CODEX_START_FAIL' },
  { name: 'Cursor', run: cursor, source: claude, command: '/tdd fix the parser', failure: 'FAKE_CURSOR_START_FAIL' },
  { name: 'Claude', run: claude, source: codex, command: '/tdd fix the parser', failure: 'FAKE_CLAUDE_INIT_FAIL' },
];

describe('command-first handover startup', () => {
  for (const { name, run, source, command, failure } of cases) {
    it(`${name} retries session creation after failure and resumes the successful command session`, async () => {
      const t = await H.start('remember the word QUINCE', source);
      await H.untilResults(t.id, 1);
      await switchRun(t.id, run);
      // Load the menu before injecting startup failure, which would also fail Claude's command probe.
      const { listCommands } = await import('../commands.ts');
      const menu = await listCommands(run.harness as 'claude-code' | 'codex' | 'cursor', t.cwd, { wait: true });
      expect(menu.commands.some((c) => c.name === command.split(' ')[0].slice(1))).toBe(true);

      process.env[failure] = '1';
      await H.runner.postMessage(t.id, command);
      await H.untilStatus(t.id, 'failed');
      await H.until('failed destination process exited', () => !lives.has(t.id));
      // Starting a process or writing its stdin does not prove a native session exists.
      expect(H.db.threads.sessionState(t.id).handover).toMatchObject({ since: 0 });
      expect(H.db.threads.sessionState(t.id).handover?.started).not.toBe(true);
      expect(H.byKind(t.id, 'handover')).toHaveLength(0);

      process.env[failure] = '0';
      await H.runner.postMessage(t.id, command);
      await H.untilStatus(t.id, 'done');
      expect(H.db.threads.sessionState(t.id).handover).toMatchObject({ since: 0, started: true });
      expect(H.byKind(t.id, 'handover')).toHaveLength(0);
      const sessionId = H.thread(t.id).session_id;

      // The pending history must survive the command's process exiting, with its native session id.
      const live = lives.get(t.id)!;
      closeLive(live);
      await live.exited;
      await H.runner.postMessage(t.id, 'what word?');
      await H.untilStatus(t.id, 'done');
      expect(H.thread(t.id).session_id).toBe(sessionId);
      expect(H.db.threads.sessionState(t.id).handover).toBeNull();
      expect(H.byKind(t.id, 'handover')).toHaveLength(1);

      if (run.harness === 'codex') {
        const requests = H.codexRequests().filter((r) => r.thread_id === t.id);
        expect(requests.filter((r) => r.method === 'thread/start')).toHaveLength(2);
        expect(requests.filter((r) => r.method === 'thread/resume')).toEqual([
          expect.objectContaining({ params: expect.objectContaining({ threadId: sessionId }) }),
        ]);
        const text = requests.filter((r) => r.method === 'turn/start').at(-1)!.params.input[0].text;
        expect(text).toContain('[the user] remember the word QUINCE');
        expect(text.endsWith('what word?')).toBe(true);
      } else if (run.harness === 'cursor') {
        const requests = H.cursorRequests().filter((r) => r.thread_id === t.id);
        expect(requests.filter((r) => r.method === 'create-chat')).toHaveLength(2);
        const lastTurn = requests.filter((r) => r.method === 'turn').at(-1)!;
        expect(lastTurn.resume).toBe(sessionId);
        expect(lastTurn.prompt).toContain('[the user] remember the word QUINCE');
        expect(lastTurn.prompt.endsWith('what word?')).toBe(true);
      } else {
        expect(H.spawns(t.id).at(-1)).toMatchObject({ resume: true, session_id: sessionId });
        const text = H.claudeTexts(t.id).at(-1)!;
        expect(text).toContain('[the user] remember the word QUINCE');
        expect(text.endsWith('what word?')).toBe(true);
      }
    }, 20_000);
  }
});
