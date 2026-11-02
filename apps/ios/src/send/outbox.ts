import { OmniHttpError, type SendMode } from '@omni/client-core';
import { contextKey, type MessageContext } from '@omni/shared/message-context.ts';

/**
 * Why a send did not go through. `ambiguous` failures may have reached the server (the answer was lost, or the server
 * failed after saving), so a retry must carry the same `request_id`. The server then answers it with the first
 * acceptance instead of sending the message twice.
 */
export interface SendFailure {
  kind: 'offline' | 'server' | 'refused' | 'signed-out';
  message: string;
  ambiguous: boolean;
}

export const OFFLINE_MESSAGE = 'Cannot reach the server. Your message is kept here. Retry when you are connected.';
export const SIGNED_OUT_MESSAGE = 'The server no longer accepts this phone, so the message was not sent.';

export function classifyFailure(error: unknown): SendFailure {
  if (!(error instanceof OmniHttpError)) {
    return { kind: 'server', message: error instanceof Error ? error.message : String(error), ambiguous: true };
  }
  const f = error.failure;
  switch (f.kind) {
    case 'unreachable':
    case 'cancelled':
      return { kind: 'offline', message: OFFLINE_MESSAGE, ambiguous: true };
    case 'http':
      if (f.status === 401) return { kind: 'signed-out', message: SIGNED_OUT_MESSAGE, ambiguous: false };
      if (f.status >= 500) return { kind: 'server', message: f.message, ambiguous: true };
      return { kind: 'refused', message: f.message, ambiguous: false };
    case 'not-json':
    case 'decoding':
    case 'redirect':
      return { kind: 'server', message: error.message, ambiguous: true };
  }
}

/** The one message on its way, or the one that failed. */
export type OutboxItem =
  | { phase: 'sending'; requestId: string; key: string; text: string; mode: SendMode | undefined; context: readonly MessageContext[] }
  | { phase: 'failed'; requestId: string; key: string; text: string; mode: SendMode | undefined; context: readonly MessageContext[]; failure: SendFailure };

/**
 * A thread's send slot. At most one message is out at a time, so the order Ben wrote them in is the order the server
 * sees them. `reuse` remembers the request id of an ambiguous failure by message key, so writing the same message
 * again after editing it away still resolves to the first send.
 */
export interface Outbox {
  item: OutboxItem | null;
  reuse: Readonly<Record<string, string>>;
}

export const EMPTY_OUTBOX: Outbox = { item: null, reuse: {} };

/** What makes two sends the same message: its text, mode and context. A retry after the thread went idle keeps its mode. */
export function sendKey(text: string, mode: SendMode | undefined, context: readonly { id: string }[] = []): string {
  return JSON.stringify(context.length ? [text, mode ?? '', contextKey(context)] : [text, mode ?? '']);
}

/** Puts a message in the slot. Null while the slot is taken, or when there is neither text nor context to send. */
export function beginSend(outbox: Outbox, text: string, mode: SendMode | undefined, newId: () => string, context: readonly MessageContext[] = []): Outbox | null {
  const trimmed = text.trim();
  if (outbox.item || (!trimmed && !context.length)) return null;
  const key = sendKey(trimmed, mode, context);
  return { ...outbox, item: { phase: 'sending', requestId: outbox.reuse[key] ?? newId(), key, text: trimmed, mode, context } };
}

/** The send is accepted: the slot empties and its id is spent. */
export function settleSend(outbox: Outbox, requestId: string): Outbox {
  if (outbox.item?.requestId !== requestId) return outbox;
  return { item: null, reuse: without(outbox.reuse, outbox.item.key) };
}

/** The send failed. Only an ambiguous failure keeps its id for the retry. */
export function failSend(outbox: Outbox, requestId: string, failure: SendFailure): Outbox {
  const item = outbox.item;
  if (item?.requestId !== requestId || item.phase !== 'sending') return outbox;
  const reuse = failure.ambiguous ? { ...outbox.reuse, [item.key]: item.requestId } : without(outbox.reuse, item.key);
  return { item: { ...item, phase: 'failed', failure }, reuse };
}

/** Sends the failed message again under its own request id. Null unless it failed and can be sent again. */
export function retrySend(outbox: Outbox): Outbox | null {
  const item = outbox.item;
  if (item?.phase !== 'failed' || item.failure.kind === 'signed-out') return null;
  return { ...outbox, item: { phase: 'sending', requestId: item.requestId, key: item.key, text: item.text, mode: item.mode, context: item.context } };
}

/** Takes the failed message out of the slot, for Ben to edit. Its text comes back. */
export function takeFailed(outbox: Outbox): { outbox: Outbox; text: string } | null {
  const item = outbox.item;
  if (item?.phase !== 'failed') return null;
  return { outbox: { ...outbox, item: null }, text: item.text };
}

function without(map: Readonly<Record<string, string>>, key: string): Record<string, string> {
  const { [key]: _gone, ...rest } = map;
  return rest;
}
