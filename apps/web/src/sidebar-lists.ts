// The sidebar's Running and Recent threads sections, read off the channel list. Pure, so the rules are tested on their
// own (apps/web/tests/sidebar-lists.test.ts); SidebarSections.running and .recent in OmniKit keep the Mac app's the same.
import type { ChannelWithRunning, ThreadStub } from './api.ts';

/** How many threads Recent threads lists. The server sends each channel's 5 latest, so the 5 latest overall are among them. */
export const RECENT_THREADS = 5;

type Listing = Pick<ChannelWithRunning, 'active' | 'recent'>;

/** The open thread's fresher copy in its own place, so a row's status follows the page without a refetch. */
const withOpen = (list: ThreadStub[], open: ThreadStub | null) => (open ? list.map((t) => (t.id === open.id ? { ...t, ...open } : t)) : list);

/** Every list once, keeping a thread's first copy. */
function unique(lists: ThreadStub[][]): ThreadStub[] {
  const seen = new Set<string>();
  return lists.flat().filter((t) => !seen.has(t.id) && !!seen.add(t.id));
}

/** Newest first; a tie goes to the lower id, so the order never flickers between reloads. */
const byCreated = (a: ThreadStub, b: ThreadStub) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id);

/** Latest activity first (a message, a run, a status change all bump updated_at), then as byCreated. */
const byActivity = (a: ThreadStub, b: ThreadStub) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at) || byCreated(a, b);

/**
 * Running: every thread at work in any channel, newest first. That is what each channel's running badge counts (running
 * and queued) plus a thread whose sub-agents still run after its turn ended. Empty when nothing runs, which hides it.
 */
export function runningThreads(channels: Listing[], open: ThreadStub | null = null): ThreadStub[] {
  return withOpen(unique(channels.map((c) => c.active ?? [])), open).sort(byCreated);
}

/** Recent threads: the `limit` threads with the latest activity in any channel, whatever their status, pinned or running. */
export function recentThreads(channels: Listing[], open: ThreadStub | null = null, limit = RECENT_THREADS): ThreadStub[] {
  return withOpen(unique(channels.map((c) => c.recent ?? [])).sort(byActivity).slice(0, limit), open);
}
