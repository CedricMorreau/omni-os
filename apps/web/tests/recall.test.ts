import { expect, it } from 'vitest';
import { recallStep, sentTexts } from '../src/components/composer/recall.ts';

const user = (id: number, p: object) => ({ id, thread_id: 't', kind: 'user', payload: JSON.stringify(p), created_at: '' });

it('keeps the messages Ben sent, oldest first', () => {
  const events = [
    user(1, { text: 'first', source: 'manual' }),
    { id: 2, thread_id: 't', kind: 'text', payload: JSON.stringify({ text: 'agent' }), created_at: '' },
    user(3, { text: 'from the conductor', source: 'conductor' }),
    user(4, { text: '', attachments: [] }),
    user(5, { text: 'second', source: 'ben' }),
  ];
  expect(sentTexts(events)).toEqual(['first', 'second']);
});

it('walks back with up and forward with down, like a shell', () => {
  const sent = ['a', 'b', 'c'];
  expect(recallStep(sent, null, -1)).toBe(2);
  expect(recallStep(sent, 2, -1)).toBe(1);
  expect(recallStep(sent, 0, -1)).toBe(0);
  expect(recallStep(sent, 1, 1)).toBe(2);
  expect(recallStep(sent, 2, 1)).toBe(null);
  expect(recallStep(sent, null, 1)).toBe(null);
  expect(recallStep([], null, -1)).toBe(null);
});
