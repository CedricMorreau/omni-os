import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const source = join(import.meta.dirname, '../../../scripts/sync-main.sh');
const dirs: string[] = [];

function git(cwd: string, ...cmd: string[]) {
  return execFileSync('git', cmd, { cwd, encoding: 'utf8' }).trim();
}

function commit(cwd: string, file: string, text: string) {
  writeFileSync(join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-q', '-m', `${file}: ${text}`);
  return git(cwd, 'rev-parse', 'HEAD');
}

/** An origin with one commit on main, a checkout cloned from it, and the script in the checkout. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'sync-main-'));
  dirs.push(root);
  const origin = join(root, 'origin');
  mkdirSync(origin);
  git(origin, 'init', '-q', '-b', 'main');
  git(origin, 'config', 'user.email', 't@example.com');
  git(origin, 'config', 'user.name', 't');
  commit(origin, 'a.txt', 'one');
  const repo = join(root, 'repo');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 't@example.com');
  git(repo, 'config', 'user.name', 't');
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(source, join(repo, 'scripts', 'sync-main.sh'));
  return { root, origin, repo };
}

function run(repo: string) {
  const out = spawnSync('bash', [join(repo, 'scripts', 'sync-main.sh')], { encoding: 'utf8' });
  return { code: out.status, out: `${out.stdout}${out.stderr}` };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sync-main.sh', () => {
  it('switches a merged branch to main and fast-forwards to origin', () => {
    const { origin, repo } = setup();
    git(repo, 'switch', '-q', '-c', 'feature');
    const latest = commit(origin, 'b.txt', 'two');

    const result = run(repo);

    expect(result.code).toBe(0);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(latest);
    expect(result.out).toContain('switched from feature to main');
  });

  it('keeps an unmerged branch and its commits when it switches', () => {
    const { repo } = setup();
    git(repo, 'switch', '-q', '-c', 'wip');
    const work = commit(repo, 'c.txt', 'mine');

    const result = run(repo);

    expect(result.code).toBe(0);
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(git(repo, 'rev-parse', 'wip')).toBe(work);
    expect(result.out).toContain('wip keeps its 1 commit that main');
  });

  it('refuses and changes nothing when tracked files have changes', () => {
    const { origin, repo } = setup();
    git(repo, 'switch', '-q', '-c', 'feature');
    writeFileSync(join(repo, 'a.txt'), 'edited');
    const before = git(repo, 'rev-parse', 'HEAD');
    commit(origin, 'b.txt', 'two');

    const result = run(repo);

    expect(result.code).toBe(1);
    expect(result.out).toMatch(/^sync-main: the checkout has uncommitted changes on feature/m);
    expect(git(repo, 'branch', '--show-current')).toBe('feature');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(before);
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('edited');
  });

  it('keeps untracked files', () => {
    const { origin, repo } = setup();
    writeFileSync(join(repo, 'notes.txt'), 'scratch');
    const latest = commit(origin, 'b.txt', 'two');

    const result = run(repo);

    expect(result.code).toBe(0);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(latest);
    expect(existsSync(join(repo, 'notes.txt'))).toBe(true);
  });

  it('fails when local main has commits origin does not', () => {
    const { origin, repo } = setup();
    commit(repo, 'local.txt', 'mine');
    commit(origin, 'b.txt', 'two');

    const result = run(repo);

    expect(result.code).toBe(1);
    expect(result.out).toContain("can't fast-forward");
  });

  it('leaves a linked worktree on its branch', () => {
    const { root, origin, repo } = setup();
    const tree = join(root, 'tree');
    git(repo, 'worktree', 'add', '-q', '-b', 'thread', tree);
    mkdirSync(join(tree, 'scripts'), { recursive: true });
    copyFileSync(source, join(tree, 'scripts', 'sync-main.sh'));
    commit(origin, 'b.txt', 'two');

    const result = run(tree);

    expect(result.code).toBe(0);
    expect(git(tree, 'branch', '--show-current')).toBe('thread');
    expect(result.out).toContain('is a worktree');
  });

  it('goes on with the local main when origin cannot be reached', () => {
    const { repo } = setup();
    git(repo, 'switch', '-q', '-c', 'feature');
    git(repo, 'remote', 'set-url', 'origin', join(repo, 'missing'));

    const result = run(repo);

    expect(result.code).toBe(0);
    expect(result.out).toContain('could not reach origin');
    expect(git(repo, 'branch', '--show-current')).toBe('main');
  });
});
