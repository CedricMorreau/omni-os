import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { startRunner } from './runner-boot.ts';

const r = await startRunner({ OMNI_KEEPALIVE_SECONDS: '0' });
const { inspectWorktree } = await import('../worktree-inventory.ts');
const { renameExtraBranches } = await import('../extra-repos.ts');
const { runsHere } = await import('../runner/state.ts');

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-C', cwd, ...args], { encoding: 'utf8' }).trim();

function repo(name: string) {
  const dir = join(r.tmp, name);
  mkdirSync(dir);
  git(dir, 'init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'README.md'), `${name}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'start');
  return dir;
}

describe('a channel with an extra repository', () => {
  it('gives each thread a worktree in it on the same branch, owned by the thread', async () => {
    const front = repo('acme-front');
    const back = repo('acme-back');
    r.db.channels.create({ id: 'acme', name: 'Acme', repo_path: front, use_worktree: 1, extra_repos: JSON.stringify([{ path: back, github: 'acme/acme-back' }]) });
    const t = await r.runner.createThread({ channel: 'acme', prompt: 'work' });
    await r.untilResults(t.id, 1);
    await r.until('process closed', () => !runsHere(t.id));
    const thread = r.thread(t.id);
    const dir = `${thread.cwd}.acme-back`;
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
    expect(git(dir, 'branch', '--show-current')).toBe(thread.branch);

    const item = await inspectWorktree(basename(dir));
    expect(item.threadId).toBe(t.id);
    expect(item.reasons.map((x) => x.code)).not.toContain('unowned');

    await renameExtraBranches(thread, 'feat/1-acme');
    expect(git(dir, 'branch', '--show-current')).toBe('feat/1-acme');
  }, 60_000);
});
