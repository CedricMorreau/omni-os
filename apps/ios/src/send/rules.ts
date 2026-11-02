import { canSteer, type HarnessInfo, type PendingMsg, type SendMode, type Thread } from '@omni/client-core';

/** A turn is running or waiting for a slot, so a message to it steers or queues instead of starting the next turn. */
export function isBusy(thread: Pick<Thread, 'status'>): boolean {
  return thread.status === 'running' || thread.status === 'queued';
}

/** Nothing runs while the worktree is being prepared, so there is nothing to stop. */
export function canStop(thread: Pick<Thread, 'status' | 'setup'>): boolean {
  return isBusy(thread) && !thread.setup;
}

type SteerFacts = Pick<Thread, 'status' | 'harness' | 'queued_harness'>;

/**
 * Whether a message to a busy thread steers. A run switch queued behind the turn makes the message wait for it too
 * (apps/server/runner/queue.ts), so nothing steers then.
 */
export function steers(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): boolean {
  return canSteer(thread.harness, catalog) && !thread.queued_harness;
}

/** The mode a send carries. Undefined on an idle thread: the server just starts the next turn. */
export function sendModeFor(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): SendMode | undefined {
  if (!isBusy(thread)) return undefined;
  return steers(thread, catalog) ? 'steer' : 'queue';
}

export function composerPlaceholder(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): string {
  if (!isBusy(thread)) return 'Follow up';
  return steers(thread, catalog) ? 'Steer the agent' : 'Queue for after this turn';
}

export function sendLabel(thread: SteerFacts, catalog: readonly HarnessInfo[] | null): string {
  if (!isBusy(thread)) return 'Send';
  return steers(thread, catalog) ? 'Send to the running turn' : 'Send after this turn';
}

/** Accepted before a restart and waiting on Ben: `recovered` never reached a harness, `uncertain` may have. */
export const isParked = (m: PendingMsg) => m.delivery === 'recovered' || m.delivery === 'uncertain';

/**
 * A parked message Ben can send again by itself. An uncertain one may already have reached the agent, so only Ben
 * decides to repeat it. A recovered one never did: Resume sends all of those, in the order they arrived.
 */
export const canSendAgain = (m: PendingMsg) => m.delivery === 'uncertain';

export const recoveredCount = (pending: readonly PendingMsg[]) => pending.filter((m) => m.delivery === 'recovered').length;

/** The line over a pending message. */
export function pendingLabel(m: PendingMsg, blocked: boolean): string {
  if (m.kind === 'crew_report') {
    const from = `Crew report${m.task_id ? ` ${m.task_id}` : ''}${m.role ? ` from ${m.role}` : ''}`;
    if (m.delivery === 'recovered') return `${from}, held for Resume`;
    if (m.delivery === 'uncertain') return `${from}, may have reached the agent before the restart`;
    return from;
  }
  if (m.delivery === 'recovered') return blocked ? 'Waiting for a session that is up to date' : 'Held after a restart';
  if (m.delivery === 'uncertain') return 'May have reached the agent before the restart';
  if (m.state === 'waiting') return 'Waiting for a free slot';
  if (m.state === 'held') return 'Queued, runs after this turn';
  return m.mode === 'interrupt' ? 'Interrupting, runs next' : 'Sent, the agent reads it next';
}

/** The newest user row the stream has delivered. A row for this phone's own message is one of these. */
export function latestUserRowId(rows: readonly { id: number; kind: string }[]): number | null {
  let latest: number | null = null;
  for (const r of rows) if (r.kind === 'user' && (latest === null || r.id > latest)) latest = r.id;
  return latest;
}
