// The wire shapes are copied here because this package imports neither the server nor the Web UI. Replies are cast to
// them, not validated.
import type { ContinueLink } from '@omni/shared/continue.ts';
import type { HandoffView, Takeover } from '@omni/shared/handoff.ts';
import { historyQuery, type Clipped, type HistoryCursor, type HistoryHead, type HistoryPage } from '@omni/shared/history.ts';
import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Answer, AnswerPayload, QuestionState } from '@omni/shared/question.ts';
import type { Run } from '@omni/shared/run-switch.ts';
import type { BasePick } from '@omni/shared/worktree-base.ts';
import { apiPath, type HttpClient } from './http.ts';

export type ThreadStatus = 'queued' | 'running' | 'done' | 'failed' | 'stopped' | 'imported';
export type ThreadSource = 'manual' | 'automation' | 'conductor' | 'import' | 'capture' | 'team';

/** A thread row, as every thread endpoint sends it. */
export interface Thread {
  id: string;
  channel_id: string;
  title: string;
  status: ThreadStatus;
  role: string | null;
  model: string | null;
  harness: string;
  /** Empty: the model's default. */
  effort: string;
  auto_reason: string | null;
  /** The run picked during a turn, applied once the thread is quiet. Null when none waits. */
  queued_harness: string | null;
  queued_model: string | null;
  queued_effort: string | null;
  session_id: string;
  has_run: number;
  cwd: string;
  branch: string | null;
  parent_id: string | null;
  task_id: string | null;
  source: ThreadSource;
  automation: string | null;
  last_text: string | null;
  suggestion: string | null;
  next_title: string | null;
  next_prompt: string | null;
  archived: number;
  folder_id: string | null;
  pinned_at: string | null;
  done_at: string | null;
  setup: 'preparing' | 'failed' | null;
  setup_error: string | null;
  resume_blocked: string | null;
  limit_state: 'limited' | 'scheduled' | null;
  limit_resets_at: string | null;
  limit_elsewhere: number;
  continued_from: string | null;
  created_at: string;
  updated_at: string;
}

/** The part of a thread the channel list sends for each of its threads. */
export type ThreadStub = Pick<Thread, 'id' | 'channel_id' | 'title' | 'status' | 'created_at' | 'updated_at' | 'folder_id' | 'harness' | 'done_at' | 'parent_id' | 'source'>;

export interface Channel {
  id: string;
  name: string;
  kind: 'client' | 'internal' | 'personal' | 'system';
  repo_path: string | null;
  github_repo: string | null;
  use_worktree: number;
  base_dir: string | null;
  store_domain: string | null;
  portal_slug: string | null;
  browser_headless: number;
  notes: string | null;
  icon: string | null;
  default_harness: string | null;
  default_model: string | null;
  default_effort: string | null;
  design_system_name: string | null;
  design_system_size: number;
  archived: number;
  created_at: string;
}

export interface Folder {
  id: string;
  channel_id: string;
  parent_id: string | null;
  name: string;
  /** Null while the channel's folders sort by name. */
  position: number | null;
  collapsed: number;
  created_at: string;
  updated_at: string;
}

export type FolderWithThreads = Folder & { count: number; running: number; threads: ThreadStub[] };

/**
 * GET /channels and /channels/:id. `active`: running and queued threads, and those whose sub-agents still run.
 * `recent`: the latest threads of any status. `handoffs`: only on the Conductor channel. Older servers leave the lists out.
 */
export type ChannelWithRunning = Channel & {
  running: number;
  active?: ThreadStub[];
  recent?: ThreadStub[];
  folders?: FolderWithThreads[];
  handoffs?: { parent: ThreadStub; children: ThreadStub[] }[];
};

export interface EventRow {
  id: number;
  thread_id: string;
  kind: string;
  /** JSON text. */
  payload: string;
  created_at: string;
}

/** A row of a history page. A clipped one comes whole from `api.event`. */
export type HistoryEvent = EventRow & { clipped?: Clipped };

export interface Artifact {
  id: number;
  thread_id: string;
  path: string;
  name: string;
  kind: string;
  size: number;
  url: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  name: string;
  path: string;
  size: number;
  mime: string;
  image: boolean;
}

/** How a message reaches a busy thread: read at its next step, run after the turn, or interrupt then run. */
export type SendMode = 'steer' | 'queue' | 'interrupt';

export type DeliveryState = 'accepted' | 'waiting' | 'held' | 'sent' | 'delivered' | 'dropped' | 'discarded' | 'cancelled' | 'recovered' | 'uncertain';

/** A message the agent has not read yet. */
export interface PendingMsg {
  uuid: string;
  kind: 'user' | 'crew_report';
  text: string;
  source?: string;
  mode: SendMode;
  state: 'waiting' | 'sent' | 'held';
  task_id?: string | null;
  role?: string | null;
  thread_id?: string;
  attachments?: Attachment[];
  context?: unknown;
  request_id?: string;
  delivery?: DeliveryState;
}

export interface ModStatus {
  thread_id: string;
  channel_id: string;
  plugin: string;
  text: string;
  updated_at: string;
}

/** GET /threads/:id?history=recent: the thread with its newest page of events. Older servers send every event and no `history`. */
export interface ThreadOpen {
  thread: Thread;
  /** Absent when the thread's channel is gone. */
  channel?: Channel;
  events: HistoryEvent[];
  history?: HistoryHead;
  artifacts: Artifact[];
  children: Thread[];
  team?: Thread[];
  parent: Thread | null;
  pending?: PendingMsg[];
  /** A warm CLI process is attached, so the next message starts at once. */
  live?: boolean;
  mods?: ModStatus[];
  /** Why this Mac cannot start a turn in the thread. */
  blocked?: string;
  handoff?: HandoffView | null;
  takeover?: Takeover;
  continued_from?: ContinueLink | null;
  continued_in?: ContinueLink[];
}

/** What the server says once a message is saved. A retry with the same `request_id` gets the same answer back. */
export interface Acceptance {
  id: string;
  request_id: string;
  state: DeliveryState;
  accepted_at: string;
  /** This `request_id` was accepted before: nothing new was saved or sent. */
  duplicate?: true;
}

export type PostedThread = Thread & { request: Acceptance };

/** POST /threads/:id/messages, without files. A prompt, context, or both. */
export interface SendMessageRequest {
  prompt: string;
  /** Left out: `steer`. */
  mode?: SendMode;
  /** The client's id for this send, kept across its retries, 1 to 200 characters. */
  request_id?: string;
  context?: readonly MessageContext[];
}

/** POST /threads, without files. A field left out takes the role's, then the channel's default, then Auto. */
export interface CreateThreadRequest {
  /** Left out: `inbox`. */
  channel?: string;
  /** The first message, not empty. */
  prompt: string;
  /** Left out: generated from the prompt. */
  title?: string;
  role?: string;
  harness?: string;
  model?: string;
  effort?: string;
  /** A folder of the channel, by id or name, at most 200 characters. A name no folder has makes one. */
  folder?: string;
  /** Where a worktree thread's branch starts. Left out: the repo's HEAD. */
  base?: BasePick;
  /** A synced machine's id, or `here`. Left out: Settings' default. */
  device?: string;
}

/** A refused answer is a 409 whose body carries the state the first answer left. */
export type AnswerResult = { state: QuestionState; via: AnswerPayload['via'] };

export interface ListArchived {
  /** Only the archived ones, in place of the others. */
  archived?: boolean;
}

export interface ListThreads {
  channel?: string;
  status?: ThreadStatus;
  /** The server's default is 50. */
  limit?: number;
}

export type OmniApi = ReturnType<typeof createOmniApi>;

const archivedQuery = (o: ListArchived = {}) => ({ archived: o.archived ? '1' : undefined });

export function createOmniApi(http: HttpClient) {
  return {
    channels: (o?: ListArchived) => http.request<ChannelWithRunning[]>('GET', apiPath`/channels`, { query: archivedQuery(o) }),
    channel: (id: string) => http.request<ChannelWithRunning>('GET', apiPath`/channels/${id}`),
    /** At most 200, most recently updated first, without team members. */
    channelThreads: (id: string, o?: ListArchived) => http.request<Thread[]>('GET', apiPath`/channels/${id}/threads`, { query: archivedQuery(o) }),
    /** Every folder, or one channel's. */
    folders: (channel?: string) => http.request<Folder[]>('GET', apiPath`/folders`, { query: { channel } }),
    threads: (o: ListThreads = {}) => http.request<Thread[]>('GET', apiPath`/threads`, { query: { ...o } }),
    /** Starts its first turn, or its worktree's setup. On another machine, the thread here is `stopped`. */
    createThread: (body: CreateThreadRequest) => http.request<Thread>('POST', apiPath`/threads`, { body }),
    thread: (id: string) => http.request<ThreadOpen>('GET', apiPath`/threads/${id}`, { query: { history: 'recent' } }),
    history: (id: string, cursor: HistoryCursor) => http.request<HistoryPage<HistoryEvent>>('GET', apiPath`/threads/${id}/history`, { query: historyQuery(cursor) }),
    event: (id: string, eventId: number) => http.request<EventRow>('GET', apiPath`/threads/${id}/events/${eventId}`),
    sendMessage: (id: string, body: SendMessageRequest) => http.request<PostedThread>('POST', apiPath`/threads/${id}/messages`, { body }),
    /** Between turns it applies at once; during one it waits. A 409 while another machine runs the thread. */
    switchRun: (id: string, run: Run) => http.request<Thread>('POST', apiPath`/threads/${id}/run`, { body: run }),
    /** A 409 for a running or queued thread. */
    setDone: (id: string, done: boolean) => http.request<Thread>('PATCH', apiPath`/threads/${id}`, { body: { done } }),
    /** One answer per question, null to skip it. */
    answerQuestion: (id: string, questionId: string, answers: readonly Answer[]) =>
      http.request<AnswerResult>('POST', apiPath`/threads/${id}/questions/${questionId}/answer`, { body: { answers } }),
    stop: (id: string) => http.request<Thread>('POST', apiPath`/threads/${id}/stop`),
  };
}
