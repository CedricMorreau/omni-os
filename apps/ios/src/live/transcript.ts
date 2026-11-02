import type { HistoryEvent } from '@omni/client-core';
import {
  ANSWER_EVENT,
  isQuestionTool,
  QUESTION_EVENT,
  type AnswerPayload,
  type QuestionPayload,
  type ThreadQuestion,
} from '@omni/shared/question.ts';

/**
 * A thread's rows, folded into what the screen draws: Ben's messages, the agent's text, each tool call with its
 * outcome, each question the agent asked with what became of it, and the end of each turn. Pure. Rows the phone does
 * not draw yet (crew reports, switches, handovers, mod lines, cloud agents) are skipped here, not guessed at.
 */
export type TranscriptItem =
  | { kind: 'user'; key: number; at: string; text: string; mode: 'steer' | 'queue' | 'interrupt' | null; dropped: boolean; clipped: boolean }
  | { kind: 'text'; key: number; at: string; text: string; clipped: boolean }
  | { kind: 'tool'; key: number; at: string; name: string; summary: string; depth: 0 | 1; state: 'running' | 'ok' | 'error'; clipped: boolean }
  | { kind: 'question'; key: number; at: string; q: ThreadQuestion }
  | { kind: 'error'; key: number; at: string; text: string }
  | { kind: 'end'; key: number; at: string; status: 'done' | 'failed' | 'stopped'; subtype: string; durationMs: number | null; costUsd: number | null };

type ToolItem = Extract<TranscriptItem, { kind: 'tool' }>;
type QuestionItem = Extract<TranscriptItem, { kind: 'question' }>;

/** The first of these input fields that holds text names what the call did: a command, a path, a pattern. */
const SUMMARY_KEYS = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'] as const;

export function toolSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const record = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return firstLine(value).slice(0, 160);
  }
  return '';
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function parsePayload(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** A question the card can draw: an id, and every question with options to pick from. */
function isQuestionPayload(p: Record<string, unknown>): p is Record<string, unknown> & QuestionPayload {
  return (
    typeof p.id === 'string' &&
    Array.isArray(p.questions) &&
    p.questions.length > 0 &&
    p.questions.every((q) => !!q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length > 0)
  );
}

export function foldTranscript(events: readonly HistoryEvent[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const tools = new Map<string, ToolItem>();
  const questions = new Map<string, QuestionItem>();

  for (const e of events) {
    const p = parsePayload(e.payload);
    if (!p) continue;
    const clipped = !!e.clipped;

    switch (e.kind) {
      case 'user': {
        const text = str(p.text);
        if (text === null) break;
        const mode = p.mode === 'steer' || p.mode === 'queue' || p.mode === 'interrupt' ? p.mode : null;
        items.push({ kind: 'user', key: e.id, at: e.created_at, text, mode, dropped: p.dropped === true, clipped });
        break;
      }
      case 'assistant_text': {
        const text = str(p.text);
        if (text === null) break;
        const last = items[items.length - 1];
        // Streamed deltas join the text above them, so one answer is one item while it arrives.
        if (last?.kind === 'text' && !last.clipped && !clipped) last.text += text;
        else items.push({ kind: 'text', key: e.id, at: e.created_at, text, clipped });
        break;
      }
      case 'tool_use': {
        const id = str(p.id);
        const name = str(p.name) ?? 'tool';
        if (id === null || (p.parent && p.parent === id) || isQuestionTool(name)) break;
        const item: ToolItem = {
          kind: 'tool',
          key: e.id,
          at: e.created_at,
          name,
          summary: toolSummary(p.input),
          depth: p.parent ? 1 : 0,
          state: 'running',
          clipped,
        };
        tools.set(id, item);
        items.push(item);
        break;
      }
      case 'tool_result': {
        const step = tools.get(str(p.tool_use_id) ?? '');
        if (step) step.state = p.is_error === true ? 'error' : 'ok';
        break;
      }
      case QUESTION_EVENT: {
        if (!isQuestionPayload(p) || questions.has(p.id)) break;
        const item: QuestionItem = {
          kind: 'question',
          key: e.id,
          at: e.created_at,
          q: { id: p.id, event_id: e.id, questions: p.questions, state: 'pending', answers: null },
        };
        questions.set(p.id, item);
        items.push(item);
        break;
      }
      case ANSWER_EVENT: {
        const answer = p as Partial<AnswerPayload>;
        const item = questions.get(str(answer.id) ?? '');
        if (item && item.q.state === 'pending' && (answer.state === 'answered' || answer.state === 'skipped' || answer.state === 'dismissed')) {
          item.q = { ...item.q, state: answer.state, answers: answer.answers ?? null };
        }
        break;
      }
      case 'result': {
        // A zero-turn success is a local slash command or a background flush, not a turn (the desktop transcript skips it too).
        if (p.ok === true && !num(p.turns)) break;
        const status = p.stopped === true ? 'stopped' : p.ok === true ? 'done' : 'failed';
        items.push({
          kind: 'end',
          key: e.id,
          at: e.created_at,
          status,
          subtype: str(p.subtype) ?? '',
          durationMs: num(p.duration_ms),
          costUsd: num(p.cost_usd),
        });
        break;
      }
      case 'error': {
        const text = str(p.text);
        if (text !== null) items.push({ kind: 'error', key: e.id, at: e.created_at, text });
        break;
      }
    }
  }
  return items;
}
