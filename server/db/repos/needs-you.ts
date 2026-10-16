import { db, now, tx } from '../connection.ts';
import { outbox } from '../sync.ts';
import { PARKED } from './requests.ts';
import { THREAD_COLUMNS, type Thread } from './threads.ts';

// Needs you: the unread results and the blockers across every thread that is not archived, not only the recent
// list. Three states stay apart here: execution (the thread's status, and the `completions` its turns left),
// read state (`result_reads`, the newest result Ben has seen per thread) and filing (folder_id, never read here).
// Reading a result writes only `result_reads`, so a thread's updated_at, status and place in the lists stay.

/** How a turn ended: the thread's status when it did. */
export type CompletionStatus = 'done' | 'failed' | 'stopped';

/** One ended turn. `uid` is its identity, the one a client sends back to say it showed it. */
export interface Completion {
  /** Order on this Mac. Never sent: a client names a result by its uid. */
  seq: number;
  uid: string;
  thread_id: string;
  status: CompletionStatus;
  /** The synced uid of the thread's newest event when the turn ended. */
  event_uid: string | null;
  created_at: string;
}

/** The newest result of a thread that Ben has not seen. */
export interface NeedsYouResult {
  uid: string;
  status: CompletionStatus;
  event_uid: string | null;
  at: string;
}

/**
 * What holds a thread up until Ben acts: `setup` (its worktree could not be prepared, `detail` says why),
 * `recovered` (messages a restart kept for Resume) or `uncertain` (a message a harness may have read before a
 * restart, sent again only when Ben says so). `count` is how many messages, for the two request kinds.
 */
export interface NeedsYouBlocker {
  kind: 'setup' | 'recovered' | 'uncertain';
  detail: string | null;
  count: number;
}

export interface NeedsYouItem {
  thread: Thread;
  /** Null when only a blocker brings the thread here. */
  result: NeedsYouResult | null;
  blockers: NeedsYouBlocker[];
  /** When it came to need Ben, newest first in the list. */
  at: string;
}

export interface NeedsYou {
  items: NeedsYouItem[];
  /** Unread results, and threads with a blocker. */
  unread: number;
  blocked: number;
}

const prefixed = THREAD_COLUMNS.split(', ').map((c) => `t.${c}`).join(', ');
const marks = PARKED.map((s) => `'${s}'`).join(',');

/**
 * Threads in the lists: not archived, not a team member (listed under its lead). A delegated thread's success
 * went to its parent as a crew report, so only its failures and stops are results for Ben.
 */
const LISTED = `t.archived = 0 AND t.source != 'team'`;

export const completions = {
  get: (uid: string) => db.prepare('SELECT * FROM completions WHERE uid = ?').get(uid) as unknown as Completion | undefined,
  /** A thread's ended turns, oldest first. */
  forThread: (threadId: string) =>
    db.prepare('SELECT * FROM completions WHERE thread_id = ? ORDER BY seq').all(threadId) as unknown as Completion[],
  latest: (threadId: string) =>
    db.prepare('SELECT * FROM completions WHERE thread_id = ? ORDER BY seq DESC LIMIT 1').get(threadId) as unknown as Completion | undefined,
};

export const resultReads = {
  get: (threadId: string) =>
    db.prepare('SELECT * FROM result_reads WHERE thread_id = ?').get(threadId) as unknown as
      | { thread_id: string; seq: number; uid: string; read_at: string }
      | undefined,
  /**
   * Ben saw this result. The watermark moves to it and never back: reading an older one after a newer one is a
   * no-op, and a turn that ended after the one shown stays unread. Null for a result this Mac does not have.
   */
  read(uid: string) {
    return tx(() => {
      const c = completions.get(uid);
      if (!c) return null;
      db.prepare(
        `INSERT INTO result_reads (thread_id, seq, uid, read_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO UPDATE SET seq = excluded.seq, uid = excluded.uid, read_at = excluded.read_at WHERE excluded.seq > result_reads.seq`,
      ).run(c.thread_id, c.seq, c.uid, now());
      return c;
    });
  },
};

type ResultRow = Thread & { r_uid: string | null; r_status: CompletionStatus | null; r_event_uid: string | null; r_at: string | null };

/** The inbox, everywhere or in one channel. */
export function needsYou(channelId?: string, threadId?: string): NeedsYou {
  const scope = `${channelId ? 'AND t.channel_id = ?' : ''} ${threadId ? 'AND t.id = ?' : ''}`;
  const args = [...(channelId ? [channelId] : []), ...(threadId ? [threadId] : [])];
  // A thread's newest result, when Ben has not read it and the thread is not running again: a reply he sent
  // since means he saw it, and the turn it starts brings its own result.
  const results = db
    .prepare(
      `SELECT ${prefixed}, c.uid AS r_uid, c.status AS r_status, c.event_uid AS r_event_uid, c.created_at AS r_at
       FROM threads t
       JOIN completions c ON c.seq = (SELECT MAX(seq) FROM completions WHERE thread_id = t.id)
       LEFT JOIN result_reads r ON r.thread_id = t.id
       WHERE ${LISTED} ${scope} AND t.status IN ('done','failed','stopped') AND c.seq > COALESCE(r.seq, 0)
         AND NOT (c.status = 'done' AND t.parent_id IS NOT NULL)`,
    )
    .all(...args) as unknown as ResultRow[];
  const setup = db
    .prepare(`SELECT ${prefixed} FROM threads t WHERE ${LISTED} ${scope} AND t.setup = 'failed'`)
    .all(...args) as unknown as Thread[];
  // Only this Mac's: another Mac's parked requests are that Mac's to resume.
  const parked = db
    .prepare(
      `SELECT ${prefixed}, m.state AS p_state, COUNT(*) AS p_count, MAX(m.updated_at) AS p_at
       FROM message_requests m JOIN threads t ON t.id = m.thread_id
       WHERE ${LISTED} ${scope} AND m.state IN (${marks}) AND (m.machine_id IS NULL OR m.machine_id = ?)
       GROUP BY t.id, m.state`,
    )
    .all(...args, outbox.machineId() ?? '') as unknown as (Thread & { p_state: 'recovered' | 'uncertain'; p_count: number; p_at: string })[];

  const items = new Map<string, NeedsYouItem>();
  const item = (t: Thread, at: string) => {
    const thread = pick(t);
    const had = items.get(thread.id);
    if (had) {
      if (at > had.at) had.at = at;
      return had;
    }
    const fresh: NeedsYouItem = { thread, result: null, blockers: [], at };
    items.set(thread.id, fresh);
    return fresh;
  };
  for (const r of results) {
    item(r, r.r_at!).result = { uid: r.r_uid!, status: r.r_status!, event_uid: r.r_event_uid, at: r.r_at! };
  }
  for (const t of setup) item(t, t.updated_at).blockers.unshift({ kind: 'setup', detail: t.setup_error, count: 0 });
  for (const p of parked) item(p, p.p_at).blockers.push({ kind: p.p_state, detail: null, count: Number(p.p_count) });
  for (const i of items.values()) i.blockers.sort((a, b) => BLOCKER_ORDER.indexOf(a.kind) - BLOCKER_ORDER.indexOf(b.kind));

  const list = [...items.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { items: list, unread: list.filter((i) => i.result).length, blocked: list.filter((i) => i.blockers.length).length };
}

const BLOCKER_ORDER: NeedsYouBlocker['kind'][] = ['setup', 'uncertain', 'recovered'];

/** Just the thread's own columns, without what the queries joined to it. */
function pick(row: Thread): Thread {
  const out: Record<string, unknown> = {};
  for (const c of THREAD_COLUMNS.split(', ')) out[c] = (row as unknown as Record<string, unknown>)[c];
  return out as unknown as Thread;
}
