import { beforeAll, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { startRunner } from './runner-boot.ts';
import { FAKE_CODEX } from './support.ts';
import { MemoryTransport } from '../sync/transport.ts';

// Runner regressions use fake CLIs and isolated state, with no access to the Mac's Keychain.
vi.mock('../secrets.ts', async (original) => ({
  ...await original<typeof import('../secrets.ts')>(),
  globalSecret: async () => null,
  secretsEnv: async () => ({}),
}));


const relay = new MemoryTransport();
const claude = { harness: 'claude-code', model: 'sonnet', effort: '' };
const codex = { harness: 'codex', model: '', effort: '' };
const write = (path: string, body: string) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
};

async function mac(machineId: string) {
  vi.resetModules();
  const h = await startRunner({ OMNI_CODEX_BIN: FAKE_CODEX, OMNI_KEEPALIVE_SECONDS: '0' });
  const sync = await import('../sync/worker.ts');
  const files = await import('../sync/files.ts');
  const { app } = await import('../app.ts');
  await (await import('../harness/catalog-service.ts')).loadCatalog(['codex']);
  const home = join(h.tmp, 'home');
  mkdirSync(home);
  files.configureFileSync({ home, env: {}, turnDelayMs: 20, openEveryMs: 0 });
  const worker = sync.createSyncWorker({ transport: relay, machineId });
  sync.setActiveWorker(worker);
  const sessionFile = (t: { cwd: string; session_id: string }) =>
    join(home, '.claude', 'projects', files.claudeProjectDir(t.cwd), `${t.session_id}.jsonl`);
  return { ...h, worker, files, app, sessionFile };
}

let a: Awaited<ReturnType<typeof mac>>;
let id: string;
let folderA: string;
let claudeSession: string;
let seenOnA: number;

beforeAll(async () => {
  a = await mac('mac-a');
  folderA = join(a.tmp, 'project');
  mkdirSync(folderA);
  a.db.channels.create({ id: 'project', name: 'Project', kind: 'internal', use_worktree: 0, base_dir: folderA });
  const t = await a.runner.createThread({
    channel: 'project', prompt: 'Remember PAPAYA', title: 'Switch between Macs', ...claude,
    files: [new File(['The checkout must stay keyboard accessible.'], 'brief.txt', { type: 'text/plain' })],
  });
  id = t.id;
  await a.untilResults(id, 1);
  await a.until('Claude process closed', () => !a.runner.isLive(id));
  claudeSession = a.thread(id).session_id;
  write(a.sessionFile(a.thread(id)), '{"type":"user","from":"mac-a-original-session"}\n');
  await a.files.turnFinished(id);

  await a.runner.switchRun(id, codex);
  await a.runner.postMessage(id, 'Codex should remember GUAVA too');
  await a.untilResults(id, 2);
  await a.until('Codex process closed', () => !a.runner.isLive(id));
  seenOnA = a.db.threads.sessionState(id).sessions['claude-code']!.seen;
  await a.files.turnFinished(id);
  expect((await a.worker.syncNow()).error).toBeUndefined();
}, 30_000);

it('switches back on the other Mac with the old session file, a UID-based delta and local upload paths', async () => {
  const b = await mac('mac-b');
  // Give B different local event ids before it receives A's transcript.
  const unrelated = await b.start('Unrelated thread', claude);
  await b.untilResults(unrelated.id, 1);
  for (let n = 0; n < 30; n++) b.db.events.add(unrelated.id, 'status', { text: `Unrelated event ${n}` });
  const folderB = join(b.tmp, 'mapped-project');
  mkdirSync(folderB);
  const mapped = await b.app.request('/api/sync/path-map', {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ map: { [folderA]: folderB } }),
  });
  expect(mapped.status).toBe(200);
  expect((await b.worker.syncNow()).error).toBeUndefined();
  const seenOnB = b.db.threads.sessionState(id).sessions['claude-code']!.seen;
  expect(seenOnB).not.toBe(seenOnA);
  expect(b.db.events.uidOf(seenOnB)).toBe(a.db.events.uidOf(seenOnA));

  await b.runner.switchRun(id, claude);
  expect(b.thread(id)).toMatchObject({ cwd: folderB, session_id: claudeSession });
  await b.runner.postMessage(id, 'Continue after Codex');
  await b.untilResults(id, 3);
  expect(b.spawns(id).at(-1)).toMatchObject({ resume: true, session_id: claudeSession });
  expect(readFileSync(b.sessionFile(b.thread(id)), 'utf8')).toContain('mac-a-original-session');
  const delta = b.claudeTexts(id).at(-1)!;
  expect(delta).toContain('You ran this thread earlier');
  expect(delta).toContain('[the user] Codex should remember GUAVA too');
  expect(delta.split('History, oldest first:\n')[1]).toMatch(/^\[Omni\] Handing over from Claude Code/);
  expect(b.byKind(id, 'handover').at(-1)!.p.session).toBe('resumed');
  expect(b.db.threads.sessionState(id).handover).toBeNull();

  // A fresh harness handover also points at B's copy of attachments, rather than A's absolute paths.
  const { buildHandover } = await import('../runner/handover.ts');
  const attachmentText = buildHandover({
    from: { ...codex, harnessName: 'Codex', modelLabel: 'Default' },
    to: { ...claude, harnessName: 'Claude Code', modelLabel: 'Sonnet' },
    session: 'fresh', user: 'Ben', thread: b.thread(id), artifacts: [],
    uploadsDir: join(b.paths.threads, id, 'uploads'), events: b.db.events.since(id),
  }).text;
  const uploadOnB = join(b.paths.threads, id, 'uploads', 'brief.txt');
  expect(attachmentText).toContain(`Attachment: brief.txt, read from ${uploadOnB}`);
  expect(readFileSync(uploadOnB, 'utf8')).toContain('keyboard accessible');
}, 30_000);
