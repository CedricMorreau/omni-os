import {
  apiPath,
  createHttpClient,
  createOmniApi,
  OmniHttpError,
  openFeed,
  openThreadLive,
  parseBaseUrl,
  ThreadHistory,
  type Artifact,
  type Channel,
  type ChannelWithRunning,
  type Fetch,
  type HistoryEvent,
  type HttpClient,
  type OmniApi,
  type PendingMsg,
  type RawResponse,
  type SSEClient,
  type SSEState,
  type SSETransport,
  type Thread,
  type ThreadOpen,
} from '@omni/client-core';
import { earlierCursor, type HistoryPage } from '@omni/shared/history.ts';

import { createActivityLive, type ActivityState } from './activity';
import { linkOf, type Link } from './connection';
import { createLibraryLive, type LibraryState } from './library';
import type { OmniSession } from './session';
import { createStore, type Store } from './store';

/** Feed messages that change the channel list's counts and rows. Usage and mod lines do not. */
const LIST_CHANGES = new Set(['thread', 'channel', 'tasks', 'folder']);
/** A burst of feed messages refetches the list once, this long after the last one. */
export const REFRESH_DEBOUNCE_MS = 300;

export interface ChannelsState {
  channels: readonly ChannelWithRunning[] | null;
  loading: boolean;
  /** The last refetch's failure. The channels it held stay on screen. */
  error: string | null;
  loadedAt: number | null;
}

export interface ThreadView {
  threadId: string;
  status: 'loading' | 'ready' | 'missing' | 'error';
  error: string | null;
  thread: Thread | null;
  channel: Channel | null;
  parent: Thread | null;
  children: Thread[];
  artifacts: Artifact[];
  pending: PendingMsg[];
  live: boolean;
  blocked: string | null;
  /** The loaded rows in order: the newest page, then any older pages Ben loaded. */
  rows: readonly HistoryEvent[];
  hasOlder: boolean;
  loadingOlder: boolean;
  /** The thread's stream state. Null before it opens. */
  link: SSEState | null;
}

/** One open thread: its detail, its bounded history and its stream. Created by `LiveHub.openThread`. */
export interface ThreadLive {
  readonly view: Store<ThreadView>;
  /** Tries the thread again after a failed open. A no-op while it is open or opening. */
  retry(): void;
  loadOlder(): Promise<void>;
  /** Replaces a clipped row with its whole payload. */
  loadFullRow(eventId: number): Promise<void>;
  /** False while Ben reads older rows, so a new row does not trim what is on screen. */
  setFollowing(following: boolean): void;
  close(): void;
}

export interface LiveHub {
  readonly channels: Store<ChannelsState>;
  /** The header's link state, reduced from the feed and the open thread. */
  readonly link: Store<Link>;
  readonly activity: Store<ActivityState>;
  readonly library: Store<LibraryState>;
  refreshChannels(): Promise<void>;
  refreshActivity(): Promise<void>;
  refreshLibrary(): Promise<void>;
  /** The file's bytes, fetched with the token here and handed on as content. Nothing downstream holds the token. */
  fetchArtifactFile(artifact: Pick<Artifact, 'id' | 'updated_at'>, signal?: AbortSignal): Promise<RawResponse>;
  openThread(threadId: string): ThreadLive;
  /** Pauses the streams while the app is in the background, and reconnects and refetches when it returns. */
  setForeground(active: boolean): void;
  /** Connects now instead of waiting out a backoff, as when the network comes back. */
  kick(): void;
  close(): void;
}

export interface LiveHubOptions {
  session: OmniSession;
  transport: SSETransport;
  fetch?: Fetch;
  now?: () => number;
}

export function createLiveHub(options: LiveHubOptions): LiveHub {
  const { session, transport } = options;
  const now = options.now ?? Date.now;
  const baseUrl = session.serverUrl ? parseBaseUrl(session.serverUrl) : null;
  const paired = baseUrl !== null;
  const http: HttpClient | null = baseUrl ? createHttpClient({ baseUrl, token: () => session.token(), fetch: options.fetch }) : null;
  const api: OmniApi | null = http ? createOmniApi(http) : null;

  const channels = createStore<ChannelsState>({ channels: null, loading: false, error: null, loadedAt: null });
  const link = createStore<Link>(linkOf({ paired, foreground: true, feed: null, thread: null }));
  const openThreads = new Set<ThreadLiveImpl>();
  let activeThread: ThreadLiveImpl | null = null;
  let foreground = true;
  let feed: SSEClient | null = null;
  let feedState: SSEState | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;

  function recomputeLink() {
    link.set(linkOf({ paired, foreground, feed: feedState, thread: activeThread?.view.get().link ?? null }));
  }

  /** Runs a request, and on a 401 asks the session for fresh credentials and runs it once more. */
  async function withAuth<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (e) {
      if (isUnauthorized(e) && (await session.refreshAuth())) return run();
      throw e;
    }
  }

  const activity = createActivityLive({ api, withAuth, now });
  const library = createLibraryLive({ api, withAuth, now });

  function requireApi(): OmniApi {
    if (!api) throw new Error('Not paired');
    return api;
  }

  function requireHttp(): HttpClient {
    if (!http) throw new Error('Not paired');
    return http;
  }

  // One refetch at a time. A call that arrives meanwhile asks for one more pass, so the last state wins.
  let refreshing: Promise<void> | null = null;
  let refreshAgain = false;
  function refreshChannels(): Promise<void> {
    if (!api) return Promise.resolve();
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    channels.set((s) => ({ ...s, loading: true }));
    refreshing = (async () => {
      do {
        refreshAgain = false;
        try {
          const list = await withAuth(() => requireApi().channels());
          channels.set({ channels: list, loading: false, error: null, loadedAt: now() });
        } catch (e) {
          channels.set((s) => ({ ...s, loading: false, error: messageOf(e) }));
        }
      } while (refreshAgain);
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  function scheduleRefresh() {
    if (refreshTimer !== null) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      void refreshChannels();
    }, REFRESH_DEBOUNCE_MS);
  }

  function startFeed(client: HttpClient) {
    feed = openFeed({
      url: client.url(apiPath`/feed`),
      token: () => session.token(),
      transport,
      refreshAuth: () => session.refreshAuth(),
      onMessage: (message) => {
        if (isListChange(message)) scheduleRefresh();
        activity.applyFeed(message);
        library.applyFeed(message);
      },
      // The feed keeps no replay, so every reconnect refetches the list. The open thread catches up through its own stream.
      onReconnect: () => {
        void refreshChannels();
        void activity.refresh();
        void library.refresh();
      },
      onState: (state) => {
        feedState = state;
        recomputeLink();
      },
    });
  }

  class ThreadLiveImpl implements ThreadLive {
    readonly view: Store<ThreadView>;
    private history: ThreadHistory<HistoryEvent> | null = null;
    private stream: SSEClient | null = null;
    private following = true;
    private opening: Promise<void> | null = null;
    private closed = false;

    constructor(private readonly threadId: string) {
      this.view = createStore<ThreadView>({
        threadId,
        status: 'loading',
        error: null,
        thread: null,
        channel: null,
        parent: null,
        children: [],
        artifacts: [],
        pending: [],
        live: false,
        blocked: null,
        rows: [],
        hasOlder: false,
        loadingOlder: false,
        link: null,
      });
    }

    private patch(next: Partial<ThreadView>) {
      this.view.set((v) => ({ ...v, ...next }));
    }

    start(): Promise<void> {
      if (this.closed) return Promise.resolve();
      if (this.opening) return this.opening;
      if (!api) {
        this.patch({ status: 'error', error: 'Not paired' });
        return Promise.resolve();
      }
      this.patch({ error: null, status: this.view.get().thread ? 'ready' : 'loading' });
      this.opening = this.open().finally(() => {
        this.opening = null;
      });
      return this.opening;
    }

    private async open(): Promise<void> {
      const id = this.threadId;
      try {
        const live = await openThreadLive<HistoryEvent, ThreadOpen>({
          load: () => withAuth(() => requireApi().thread(id)),
          streamUrl: (after) => requireHttp().url(apiPath`/threads/${id}/stream`, { after }),
          token: () => session.token(),
          transport,
          refreshAuth: () => session.refreshAuth(),
          onDetail: (detail) => this.applyDetail(detail),
          onHistory: (history) => {
            this.history = history as ThreadHistory<HistoryEvent>;
            this.publishRows();
          },
          onOther: (message) => this.applyOther(message),
          onState: (state) => {
            this.patch({ link: state });
            if (activeThread === this) recomputeLink();
          },
          follows: () => this.following,
        });
        this.stream = live.stream;
        if (this.closed) live.stream.close();
      } catch (e) {
        if (this.closed) return;
        if (isStatus(e, 404)) this.patch({ status: 'missing', error: null });
        else this.patch({ status: 'error', error: messageOf(e) });
      }
    }

    private applyDetail(detail: Partial<ThreadOpen>) {
      const prev = this.view.get();
      this.patch({
        status: 'ready',
        error: null,
        thread: detail.thread ?? prev.thread,
        channel: detail.channel ?? null,
        parent: detail.parent ?? null,
        children: detail.children ?? prev.children,
        artifacts: detail.artifacts ?? prev.artifacts,
        pending: detail.pending ?? [],
        live: detail.live ?? false,
        blocked: detail.blocked ?? null,
      });
    }

    /** A status change arrives as a `thread` message on the stream, not as rows. */
    private applyOther(message: unknown) {
      if (!isRecord(message) || message.kind !== 'thread' || !isRecord(message.thread)) return;
      this.patch({
        status: 'ready',
        thread: message.thread as unknown as Thread,
        pending: Array.isArray(message.pending) ? (message.pending as PendingMsg[]) : [],
        live: message.live === true,
        blocked: typeof message.blocked === 'string' ? message.blocked : null,
      });
    }

    private publishRows() {
      if (!this.history) return;
      const h = this.history.history;
      this.patch({ rows: h.rows, hasOlder: earlierCursor(h) !== null });
    }

    async loadOlder(): Promise<void> {
      if (!this.history || this.view.get().loadingOlder) return;
      const cursor = earlierCursor(this.history.history);
      if (!cursor) return;
      const id = this.threadId;
      this.patch({ loadingOlder: true });
      try {
        await this.history.page(cursor, (query) =>
          withAuth(() => requireHttp().request<HistoryPage<HistoryEvent>>('GET', apiPath`/threads/${id}/history`, { query })),
        );
        this.publishRows();
      } catch (e) {
        this.patch({ error: messageOf(e) });
      } finally {
        this.patch({ loadingOlder: false });
      }
    }

    async loadFullRow(eventId: number): Promise<void> {
      if (!this.history) return;
      const id = this.threadId;
      await this.history.fullRow(eventId, (rowId) => withAuth(() => requireApi().event(id, rowId)));
      this.publishRows();
    }

    setFollowing(following: boolean) {
      this.following = following;
    }

    pause() {
      this.stream?.pause();
    }

    resume() {
      if (this.stream) this.stream.resume();
      else if (this.view.get().status === 'error') void this.start();
    }

    retry() {
      void this.start();
    }

    close() {
      if (this.closed) return;
      this.closed = true;
      this.stream?.close();
      this.stream = null;
      openThreads.delete(this);
      if (activeThread === this) {
        activeThread = null;
        recomputeLink();
      }
    }
  }

  if (http) {
    startFeed(http);
    void refreshChannels();
    void activity.refresh();
    void library.refresh();
  }
  recomputeLink();

  return {
    channels,
    link,
    activity: activity.state,
    library: library.state,
    refreshChannels,
    refreshActivity: activity.refresh,
    refreshLibrary: library.refresh,
    fetchArtifactFile: (artifact, signal) => withAuth(() => requireApi().artifactFile(artifact, signal)),
    openThread(threadId) {
      const thread = new ThreadLiveImpl(threadId);
      openThreads.add(thread);
      activeThread = thread;
      recomputeLink();
      void thread.start();
      return thread;
    },
    setForeground(active) {
      foreground = active;
      if (!active) {
        feed?.pause();
        for (const t of openThreads) t.pause();
      } else {
        feed?.resume();
        for (const t of openThreads) t.resume();
        void refreshChannels();
        void activity.refresh();
        void library.refresh();
      }
      recomputeLink();
    },
    kick() {
      if (!foreground) return;
      feed?.resume();
      for (const t of openThreads) t.resume();
    },
    close() {
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      refreshTimer = null;
      library.close();
      feed?.close();
      feed = null;
      for (const t of [...openThreads]) t.close();
    },
  };
}

function isUnauthorized(e: unknown): boolean {
  return isStatus(e, 401);
}

function isStatus(e: unknown, status: number): boolean {
  return e instanceof OmniHttpError && e.failure.kind === 'http' && e.failure.status === status;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isListChange(message: unknown): boolean {
  return isRecord(message) && typeof message.type === 'string' && LIST_CHANGES.has(message.type);
}

function messageOf(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong';
}
