import type { HarnessInfo, OmniApi, Recovered, Thread } from '@omni/client-core';

import { createStore, type Store } from '../live/store';
import { beginSend, classifyFailure, EMPTY_OUTBOX, failSend, retrySend, settleSend, takeFailed, type Outbox, type OutboxItem } from './outbox';
import { sendModeFor } from './rules';

export interface SendState {
  outbox: Outbox;
  stopping: boolean;
  /** The held-message action under way, as `again:<uuid>` or `discard:<uuid>`. Null when none is. */
  heldBusy: string | null;
  /** Why the last Stop or held-message action failed. The next action clears it. */
  notice: string | null;
}

export const IDLE_SEND: SendState = { outbox: EMPTY_OUTBOX, stopping: false, heldBusy: null, notice: null };

export interface SenderDeps {
  threadId: string;
  api(): OmniApi;
  /** Runs a request and, on a 401, once more after the session refreshed its credentials. */
  run<T>(call: () => Promise<T>): Promise<T>;
  /** The harness catalog as far as it has loaded. Null falls back to the harness's name. */
  catalog(): readonly HarnessInfo[] | null;
  newId(): string;
}

/** What a thread's composer does, as one store the screen reads and a handful of calls the screen makes. */
export interface ThreadSender {
  readonly state: Store<SendState>;
  /** Sends `text` to `thread`, in the mode its status and harness call for. Resolves with the thread the server answered with, or null when nothing was sent or it failed (the outbox says which). */
  submit(thread: Thread, text: string): Promise<Thread | null>;
  /** Sends the failed message again under its own request id. */
  retry(): Promise<Thread | null>;
  /** Takes the failed message out of the outbox and returns its text. */
  edit(): string | null;
  stop(): Promise<Thread | null>;
  /** Sends held messages again. They are named, so an uncertain one goes too. */
  resume(uuid: string): Promise<Recovered | null>;
  discard(uuid: string): Promise<Recovered | null>;
}

export function createSender(deps: SenderDeps): ThreadSender {
  const state = createStore<SendState>(IDLE_SEND);
  const patch = (next: Partial<SendState>) => state.set((s) => ({ ...s, ...next }));
  const outbox = (fn: (o: Outbox) => Outbox) => state.set((s) => ({ ...s, outbox: fn(s.outbox) }));

  async function transmit(item: OutboxItem): Promise<Thread | null> {
    try {
      const posted = await deps.run(() => deps.api().sendMessage(deps.threadId, { prompt: item.text, mode: item.mode, request_id: item.requestId }));
      outbox((o) => settleSend(o, item.requestId));
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

  return {
    state,
    async submit(thread, text) {
      const next = beginSend(state.get().outbox, text, sendModeFor(thread, deps.catalog()), deps.newId);
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
    resume: (uuid) => held(`again:${uuid}`, () => deps.run(() => deps.api().resumeRequests(deps.threadId, [uuid]))),
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
