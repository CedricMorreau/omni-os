// Switching a thread's harness, model or effort between turns. switch-plan.ts decides what happens to its sessions,
// this applies it; the next spawn hands the thread over when the harness changed (handover.ts).
import { sameRun, type Run, type RunName, type SwitchP } from '@omni/shared/run-switch.ts';
import { artifacts, events, threads, type Thread } from '../db.ts';
import { forgetContext } from '../context.ts';
import { userName } from '../profile.ts';
import { getHarness, resolveModel, unavailableError, validateRun, type Catalog } from '../harness/catalog.ts';
import { freshCatalog, getCatalog } from '../harness/catalog-service.ts';
import { HARNESS_META, isHarnessId, type HarnessId } from '../harness/types.ts';
import { turnBlocked } from '../sync/guard.ts';
import { buildHandover } from './handover.ts';
import { closeLive } from './session.ts';
import { planSwitch } from './switch-plan.ts';
import { adapterFor, addEvent, emitThread, hasBackground, lives, refusal, runsHere, waiting, waitingMsgs, type Live } from './state.ts';

/** A run with the names the catalog gives it now, so its transcript row reads the same later. */
export function runName(run: Run, cat: Catalog = getCatalog()): RunName {
  const id = run.harness as HarnessId;
  const h = getHarness(cat, id);
  const model = run.model ? resolveModel(cat, id, run.model) : h?.models.find((m) => m.default);
  return {
    ...run,
    harnessName: h?.name ?? HARNESS_META[id]?.name ?? run.harness,
    modelLabel: model?.label ?? (run.model || 'default model'),
  };
}

const runOf = (t: Thread): Run => ({ harness: t.harness, model: t.model ?? '', effort: t.effort });

/** Why the run cannot change right now, or null. A switch waits for a quiet thread so no turn spans two runs. */
function busy(t: Thread): string | null {
  const live = lives.get(t.id);
  if (t.status === 'running' || t.status === 'queued' || live?.turn) return 'Switch after this turn.';
  if (waiting.includes(t.id) || waitingMsgs.get(t.id)?.length || live?.held.length || live?.inflight.length) {
    return 'Messages are still waiting to run. Switch once they have.';
  }
  if (live && hasBackground(live)) return 'Background tasks still run in this thread. Switch once they finish.';
  if (t.setup === 'preparing') return "The thread's worktree is still being made.";
  return turnBlocked(t, runsHere(t.id));
}

/** The catalog's objection to a run, or null. */
function invalid(cat: Catalog, to: Run & { harness: HarnessId }): string | null {
  const h = getHarness(cat, to.harness);
  if (!h) return `Unknown harness "${to.harness}".`;
  if (!h.available) return unavailableError(h.name, h.fix);
  const r = validateRun(cat, to.harness, to.model || h.models.find((m) => m.default)?.id || h.models[0]?.id || '', to.effort);
  return r.ok ? null : r.error;
}

/**
 * Move a thread to another run between turns. The same run again changes nothing. The transcript gets a `switch`
 * row, and a warm process from the old run closes so the next turn starts on the new one.
 */
export async function switchRun(threadId: string, to: Run): Promise<Thread> {
  const t = threads.get(threadId);
  if (!t) throw refusal('thread not found', 404);
  if (sameRun(runOf(t), to)) return t;
  if (!isHarnessId(to.harness)) throw refusal(`Unknown harness "${to.harness}".`, 400);
  const target = { ...to, harness: to.harness };
  // Ben may have just logged in to the harness: look again before refusing.
  if (invalid(getCatalog(), target)) {
    const error = invalid(await freshCatalog(), target);
    if (error) throw refusal(error, 400);
  }
  const now = threads.get(threadId)!;
  const why = busy(now);
  if (why) throw refusal(why, 409);

  const cat = getCatalog();
  const from = runName(runOf(now), cat);
  const plan = planSwitch({ ...runOf(now), id: now.id, has_run: now.has_run, session_id: now.session_id, ...threads.sessionState(threadId) }, to, from, events.lastId(threadId), (id) =>
    events.hasContentAfter(threadId, id),
  );
  if (plan.kind === 'none') return now;
  if (plan.kind === 'reject') throw refusal(plan.error, 400);
  threads.update(threadId, {
    harness: to.harness,
    model: to.model || null,
    effort: to.effort,
    auto_reason: null,
    session_id: plan.session_id,
    sessions: plan.sessions,
    handover: plan.handover,
  });
  addEvent(threadId, 'switch', { from, to: runName(to, cat), mode: plan.kind } satisfies SwitchP);
  // The meter's reading is the old session's.
  if (to.harness !== now.harness) forgetContext(threadId);
  const live = lives.get(threadId);
  if (live) closeLive(live);
  emitThread(threadId);
  return threads.get(threadId)!;
}

/**
 * At spawn: a pending handover goes ahead of the first message, and decides whether the harness resumes. A fresh
 * session gets its id here, so a process that dies before it starts leaves the handover pending for the next spawn.
 */
export function takeHandover(live: Live, thread: Thread): { thread: Thread; resume: boolean } {
  const { handover } = threads.sessionState(thread.id);
  const first = live.inflight[0];
  if (!handover || !first) return { thread, resume: !!thread.has_run };
  const session = handover.since ? 'resumed' : 'fresh';
  if (session === 'fresh') {
    thread = { ...thread, session_id: adapterFor(thread.harness).freshSessionId(thread) };
    threads.update(thread.id, { session_id: thread.session_id });
    live.sessionId = thread.session_id;
  }
  const to = runName(runOf(thread));
  const h = buildHandover({
    from: handover.from,
    to,
    session,
    user: userName(),
    thread,
    artifacts: artifacts.byThread(thread.id).reverse().slice(0, 20).map((a) => a.name),
    // The messages about to go are not in the transcript yet: each lands there when the harness reads it.
    events: events.since(thread.id, handover.since),
  });
  first.text = h.text + first.text;
  first.commands = first.commands?.map((c) => ({ ...c, start: c.start + h.text.length, end: c.end + h.text.length }));
  live.handover = { to, session, entries: h.entries, omitted: h.omitted, chars: h.chars };
  return { thread, resume: session === 'resumed' };
}

/** The new session started with the handover: the transcript says so and the thread no longer has one pending. */
export function handedOver(live: Live) {
  const done = live.handover;
  if (!done) return;
  live.handover = undefined;
  threads.update(live.threadId, { handover: null });
  addEvent(live.threadId, 'handover', done);
  emitThread(live.threadId);
}
