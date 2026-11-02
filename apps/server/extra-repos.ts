import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { promisify } from 'node:util';
import { paths } from './config.ts';
import { channels, parseJsonList, threadBasePicks, type Channel, type Thread } from './db.ts';
import { prepareWorktree } from './sandbox.ts';
import { resolvePick } from './worktree-base.ts';
import { withWorkspace } from './workspace.ts';

const run = promisify(execFile);

export interface ExtraRepo {
  path: string;
  github: string | null;
}

export const extraRepos = (channel: Pick<Channel, 'extra_repos'> | undefined | null) => parseJsonList<ExtraRepo>(channel?.extra_repos ?? null);

export interface ExtraWorktree extends ExtraRepo {
  dir: string;
}

export function extraWorktrees(thread: Pick<Thread, 'cwd' | 'branch' | 'channel_id'>): ExtraWorktree[] {
  if (!thread.branch || dirname(thread.cwd) !== paths.worktrees) return [];
  return extraRepos(channels.get(thread.channel_id)).map((r) => ({ ...r, dir: `${thread.cwd}.${basename(r.path)}` }));
}

export const worktreeThreadId = (id: string) => (id.startsWith('.') || !id.includes('.') ? id : id.slice(0, id.indexOf('.')));

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

export function isExtraRepoOf(channel: Channel | null, repo: string) {
  return extraRepos(channel).some((r) => real(r.path) === real(repo));
}

async function baseIn(repo: string, threadId: string, channel: Channel | undefined) {
  const picks = [threadBasePicks.get(threadId), channel?.default_base ? { kind: 'ref' as const, ref: channel.default_base } : null];
  for (const pick of picks) {
    if (!pick || pick.kind === 'head') continue;
    const sha = await resolvePick(repo, pick).then((r) => r.sha, () => null);
    if (sha) return sha;
  }
  return 'HEAD';
}

export async function prepareExtraWorktrees(thread: Thread) {
  const channel = channels.get(thread.channel_id);
  for (const w of extraWorktrees(thread)) {
    await withWorkspace(w.dir, () => prepareWorktree(w.path, w.dir, thread.branch!, () => baseIn(w.path, thread.id, channel)));
  }
}

export async function renameExtraBranches(thread: Pick<Thread, 'cwd' | 'branch' | 'channel_id'>, to: string) {
  for (const w of extraWorktrees(thread)) await run('git', ['-C', w.path, 'branch', '-m', thread.branch!, to]).catch(() => {});
}

export function extraRepoLines(thread: Thread): string[] {
  const list = extraWorktrees(thread);
  if (!list.length) return [];
  return [
    `- This client has more repositories. Each has its own worktree for this thread, on the same branch ${thread.branch}:`,
    ...list.map((w) => `  - ${w.dir}${w.github ? ` (${w.github})` : ''}`),
    '  Commit and push each repository on its own. Open a PR in each repository you changed.',
  ];
}

export const extraWorktreeDirs = (thread: Thread) => extraWorktrees(thread).map((w) => w.dir);
