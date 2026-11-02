import type { HarnessInfo, OmniApi, PendingMsg, Recovered, Thread } from '@omni/client-core';

import type { MessageContext } from '@omni/shared/message-context.ts';

import { createStore, type Store } from '../live/store';
import { beginSend, classifyFailure, EMPTY_OUTBOX, failSend, retrySend, settleSend, takeFailed, type Outbox, type OutboxItem } from './outbox';
import { sendModeFor } from './rules';

export interface SendState {
  outbox: Outbox;
  stopping: boolean;
  /** The held-message action under way, as `again:<uuid>`, `discard:<uuid>` or `resume`. Null when none is. */
  heldBusy: string | null;
  /** Why the last Stop or held-message action failed. The next action clears it. */
  notice: string | null;
}

/** The `heldBusy` key while Resume runs. */
export const RESUME_ALL = 'resume';

export const IDLE_SEND: SendState = { outbox: EMPTY_OUTBOX, stopping: false, heldBusy: null, notice: null };

export interface SenderDeps {
  threadId: string;
  api(): OmniApi;
  /** Runs a request and, on a 401, once more after the session refreshed its credentials. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /** The harness catalog as far as it has loaded. Null falls back to the harness's name. */
  catalog(): readonly HarnessInfo[] | null;
  newId(): string;
  /** A message left the slot because the server has it. */
  landed?(threadId: string, item: OutboxItem): void;
}

/** What the stream has shown of the thread, as far as it says whether a send landed. */
export interface FeedSight {
  pending: readonly PendingMsg[];
  /** The newest user row on the stream. A new one means a message was just read, and it may be this phone's. */
  userRowId: number | null;
}

/** What a thread's composer does, as one store the screen reads and a handful of calls the screen makes. */
export interface ThreadSender {
  readonly state: Store<SendState>;
  /** Sends `text` and `context` to `thread`, in the mode its status and harness call for. Resolves with the thread the server answered with, or null when nothing was sent or it failed (the outbox says which). */
  submit(thread: Thread, text: string, context?: readonly MessageContext[]): Promise<Thread | null>;
  /** Sends the failed message again under its own request id. */
  retry(): Promise<Thread | null>;
  /** Takes the failed message out of the outbox and returns its text. */
  edit(): string | null;
  stop(): Promise<Thread | null>;
  /**
   * Drops the message in the slot once the server turns out to have it, so it never shows twice: in the transcript and
   * here. A pending row carries the request id. A user row does not, so each new one is checked against the server's
   * list of accepted requests. Fed by the stream, and needs no reply.
   */
  observe(sight: FeedSight): void;
  /** Sends held messages. Named, an uncertain one goes too. Without a name, every recovered one goes, in order. */
  resume(uuid?: string): Promise<Recovered | null>;
  discard(uuid: string): Promise<Recovered | null>;
}

export function createSender(deps: SenderDeps): ThreadSender {
  const state = createStore<SendState>(IDLE_SEND);
  const patch = (next: Partial<SendState>) => state.set((s) => ({ ...s, ...next }));
  const outbox = (fn: (o: Outbox) => Outbox) => state.set((s) => ({ ...s, outbox: fn(s.outbox) }));
  const settle = (item: OutboxItem) => {
    const before = state.get().outbox.item;
    outbox((o) => settleSend(o, item.requestId));
    if (before?.requestId === item.requestId) deps.landed?.(deps.threadId, item);
  };

  async function transmit(item: OutboxItem): Promise<Thread | null> {
    try {
      const posted = await deps.run(() => deps.api().sendMessage(deps.threadId, { prompt: item.text, mode: item.mode, request_id: item.requestId, context: item.context.length ? item.context : undefined }));
      settle(item);
      return posted;
    } catch (e) {
      outbox((o) => failSend(o, item.requestId, classifyFailure(e)));
      return null;
    }
  }

  async function held<T>(key: string, call: () => Promise<T>): Promise<T | null> {
    if (state.get().heldBusy) return null;
    patch({ heldBusy: key, notice: null });
    try {
      return await call();
    } catch (e) {
      patch({ notice: classifyFailure(e).message });
      return null;
    } finally {
      patch({ heldBusy: null });
    }
  }

  let latest: FeedSight = { pending: [], userRowId: null };
  let checking = false;
  let checked: { requestId: string; rowId: number | null } | null = null;

  async function settleIfLanded(sight: FeedSight): Promise<void> {
    const item = state.get().outbox.item;
    // A refused send never reached the server, so nothing on the stream can be it.
    if (!item || (item.phase === 'failed' && !item.failure.ambiguous)) return;
    const landed = () => settle(item);
    if (sight.pending.some((m) => m.request_id === item.requestId)) return landed();
    if (sight.userRowId === null || checking) return;
    if (checked?.requestId === item.requestId && checked.rowId === sight.userRowId) return;
    checking = true;
    try {
      const accepted = await deps.run(() => deps.api().requests(deps.threadId));
      checked = { requestId: item.requestId, rowId: sight.userRowId };
      if (accepted.some((r) => r.request_id === item.requestId)) landed();
    } catch {
      // The next user row asks again.
    } finally {
      checking = false;
    }
    // A row that arrived during the check has not been asked about.
    if (latest !== sight) void settleIfLanded(latest);
  }

  return {
    state,
    observe(sight) {
      latest = sight;
      void settleIfLanded(sight);
    },
    async submit(thread, text, context = []) {
      const next = beginSend(state.get().outbox, text, sendModeFor(thread, deps.catalog()), deps.newId, context);
      if (!next?.item) return null;
      patch({ outbox: next, notice: null });
      return transmit(next.item);
    },
    async retry() {
      const next = retrySend(state.get().outbox);
      if (!next?.item) return null;
      patch({ outbox: next, notice: null });
      return transmit(next.item);
    },
    edit() {
      const taken = takeFailed(state.get().outbox);
      if (!taken) return null;
      patch({ outbox: taken.outbox });
      return taken.text;
    },
    async stop() {
      if (state.get().stopping) return null;
      patch({ stopping: true, notice: null });
      try {
        return await deps.run(() => deps.api().stop(deps.threadId));
      } catch (e) {
        patch({ notice: classifyFailure(e).message });
        return null;
      } finally {
        patch({ stopping: false });
      }
    },
    resume: (uuid) => held(uuid ? `again:${uuid}` : RESUME_ALL, () => deps.run(() => deps.api().resumeRequests(deps.threadId, uuid ? [uuid] : undefined))),
    discard: (uuid) => held(`discard:${uuid}`, () => deps.run(() => deps.api().discardRequests(deps.threadId, [uuid]))),
  };
}

/** The harness catalog, loaded once and kept. A failed load leaves it null, and sends fall back to each harness's usual behavior. */
export function createCatalog(load: () => Promise<readonly HarnessInfo[]>) {
  const store = createStore<readonly HarnessInfo[] | null>(null);
  let loading: Promise<void> | null = null;
  return {
    store,
    /** Loads it unless it is loaded or loading. Never rejects. */
    ensure(): Promise<void> {
      if (store.get() || loading) return loading ?? Promise.resolve();
      loading = load().then(
        (list) => store.set(list),
        () => undefined,
      ).finally(() => {
        loading = null;
      });
      return loading;
    },
  };
}

export function createSenders(deps: Omit<SenderDeps, 'threadId'>) {
  const senders = new Map<string, ThreadSender>();
  return {
    /** One sender per thread for the life of the hub, so a message that failed is still there when Ben comes back to the thread. */
    for(threadId: string): ThreadSender {
      let sender = senders.get(threadId);
      if (!sender) {
        sender = createSender({ ...deps, threadId });
        senders.set(threadId, sender);
      }
      return sender;
    },
  };
}

export function newRequestId(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
