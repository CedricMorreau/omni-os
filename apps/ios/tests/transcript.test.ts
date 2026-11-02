import type { HistoryEvent } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { foldTranscript, toolSummary } from '../src/live/transcript';

let nextId = 1;
function ev(kind: string, payload: Record<string, unknown>, extra: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id: nextId++,
    thread_id: 't',
    kind,
    payload: JSON.stringify(payload),
    created_at: '2026-11-02T12:00:00Z',
    ...extra,
  };
}

describe('foldTranscript', () => {
  it('joins streamed text deltas into one answer', () => {
    const items = foldTranscript([
      ev('assistant_text', { text: 'Hel' }),
      ev('assistant_text', { text: 'lo' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'text', text: 'Hello' });
  });

  it('keeps a clipped answer apart from the text around it', () => {
    const items = foldTranscript([
      ev('assistant_text', { text: 'first' }),
      ev('assistant_text', { text: 'cut…' }, { clipped: { full: false } as unknown as HistoryEvent['clipped'] }),
      ev('assistant_text', { text: 'after' }),
    ]);
    expect(items.map((i) => (i.kind === 'text' ? i.text : i.kind))).toEqual(['first', 'cut…', 'after']);
  });

  it('pairs each tool call with its result, and nests sub-agent calls', () => {
    const items = foldTranscript([
      ev('tool_use', { id: 'a', name: 'Bash', input: { command: 'npm test' } }),
      ev('tool_use', { id: 'b', name: 'Read', input: { file_path: 'x.ts' }, parent: 'a' }),
      ev('tool_result', { tool_use_id: 'a', is_error: true }),
      ev('tool_result', { tool_use_id: 'b' }),
    ]);
    expect(items).toEqual([
      expect.objectContaining({ kind: 'tool', name: 'Bash', summary: 'npm test', state: 'error', depth: 0 }),
      expect.objectContaining({ kind: 'tool', name: 'Read', summary: 'x.ts', state: 'ok', depth: 1 }),
    ]);
  });

  it('shows a call as running until its result arrives', () => {
    const [item] = foldTranscript([ev('tool_use', { id: 'a', name: 'Grep', input: {} })]);
    expect(item).toMatchObject({ kind: 'tool', state: 'running', summary: '' });
  });

  it('draws a user message with its send mode and a dropped note', () => {
    const [item] = foldTranscript([ev('user', { text: 'stop', mode: 'interrupt', dropped: true })]);
    expect(item).toMatchObject({ kind: 'user', text: 'stop', mode: 'interrupt', dropped: true });
  });

  it('ends a turn with its outcome, and skips a zero-turn success', () => {
    const items = foldTranscript([
      ev('result', { ok: true, turns: 0 }),
      ev('result', { ok: true, turns: 2, duration_ms: 4200, cost_usd: 0.031 }),
      ev('result', { ok: false, subtype: 'error_max_turns' }),
      ev('result', { ok: true, stopped: true, turns: 1 }),
    ]);
    expect(items.map((i) => (i.kind === 'end' ? i.status : i.kind))).toEqual(['done', 'failed', 'stopped']);
    expect(items[0]).toMatchObject({ durationMs: 4200, costUsd: 0.031 });
  });

  it('skips rows it cannot read rather than guessing', () => {
    const items = foldTranscript([
      { id: 1, thread_id: 't', kind: 'assistant_text', payload: '{not json', created_at: '' },
      ev('crew_report', { text: 'not drawn yet' }),
      ev('error', { text: 'boom' }),
    ]);
    expect(items).toEqual([expect.objectContaining({ kind: 'error', text: 'boom' })]);
  });
});

describe('toolSummary', () => {
  it('uses the first telling field and only its first line', () => {
    expect(toolSummary({ command: 'npm test\nnpm run lint' })).toBe('npm test');
    expect(toolSummary({ pattern: 'TODO', path: 'src' })).toBe('src');
  });

  it('is empty when no field names what the call did', () => {
    expect(toolSummary({ count: 3 })).toBe('');
    expect(toolSummary(null)).toBe('');
  });
});

describe('foldTranscript questions', () => {
  const questions = [
    {
      question: 'Which goal first?',
      multiSelect: false,
      options: [
        { label: 'Ship', description: '' },
        { label: 'Test', description: '' },
      ],
    },
  ];
  const asked = () => ev('question', { id: 'q1', questions });

  it('draws a question the agent asked as pending, in place of its tool call', () => {
    const items = foldTranscript([
      ev('assistant_text', { text: 'One thing first.' }),
      ev('tool_use', { id: 'call', name: 'mcp__omni-ask__ask_user_question', input: { questions } }),
      asked(),
    ]);
    expect(items.map((i) => i.kind)).toEqual(['text', 'question']);
    expect(items[1]).toMatchObject({ kind: 'question', q: { id: 'q1', state: 'pending', answers: null } });
  });

  it('settles it with the answer event, and keeps the first answer', () => {
    const answers = [{ selected: ['Ship'], other: null }];
    const items = foldTranscript([
      asked(),
      ev('question_answer', { id: 'q1', state: 'answered', answers, via: 'tool' }),
      ev('question_answer', { id: 'q1', state: 'dismissed', answers: null, via: 'tool' }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ q: { state: 'answered', answers } });
  });

  it('leaves out a question it cannot draw, and an answer for one it never saw', () => {
    const items = foldTranscript([
      ev('question', { id: 'q2', questions: [] }),
      ev('question', { id: 'q3' }),
      ev('question_answer', { id: 'nope', state: 'answered', answers: null }),
    ]);
    expect(items).toEqual([]);
  });

  it('still draws other tool calls', () => {
    const items = foldTranscript([ev('tool_use', { id: 'a', name: 'Bash', input: { command: 'ls' } })]);
    expect(items.map((i) => i.kind)).toEqual(['tool']);
  });
});
