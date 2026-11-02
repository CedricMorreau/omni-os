import type { MessageContext } from '@omni/shared/message-context.ts';
import type { Answer, AnswerPayload, QuestionState } from '@omni/shared/question.ts';
import { apiPath, type HttpClient } from '../http.ts';
import type { Thread } from './threads.ts';

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

/** A refused answer is a 409 whose body carries the state the first answer left. */
export type AnswerResult = { state: QuestionState; via: AnswerPayload['via'] };

export function messagesApi(http: HttpClient) {
  return {
    /** Send with a `request_id` and retry with the same one: the second answer is the first, marked `duplicate`. */
    sendMessage: (id: string, body: SendMessageRequest) => http.request<PostedThread>('POST', apiPath`/threads/${id}/messages`, { body }),
    /** One answer per question, null to skip it. */
    answerQuestion: (id: string, questionId: string, answers: readonly Answer[]) =>
      http.request<AnswerResult>('POST', apiPath`/threads/${id}/questions/${questionId}/answer`, { body: { answers } }),
    stop: (id: string) => http.request<Thread>('POST', apiPath`/threads/${id}/stop`),
  };
}
