import { beforeEach, describe, expect, it } from 'vitest';

import { getDraft, restoreDraft, setDraft } from '../src/components/thread/drafts';

describe('composer drafts', () => {
  beforeEach(() => {
    setDraft('a', '');
    setDraft('b', '');
  });

  it('keeps a draft per thread', () => {
    setDraft('a', 'first');
    setDraft('b', 'second');
    expect(getDraft('a')).toBe('first');
    expect(getDraft('b')).toBe('second');
    expect(getDraft('c')).toBe('');
  });

  it('forgets a draft that is emptied', () => {
    setDraft('a', 'first');
    setDraft('a', '');
    expect(getDraft('a')).toBe('');
  });

  it('puts a restored message in front of a draft typed since', () => {
    setDraft('a', 'typed meanwhile');
    restoreDraft('a', 'failed message');
    expect(getDraft('a')).toBe('failed message\n\ntyped meanwhile');
  });

  it('restores into an empty or blank box without padding', () => {
    restoreDraft('a', 'failed message');
    expect(getDraft('a')).toBe('failed message');
    setDraft('b', '  \n');
    restoreDraft('b', 'failed message');
    expect(getDraft('b')).toBe('failed message');
  });
});
