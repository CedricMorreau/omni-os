import type { PendingMsg } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { canSendAgain, latestUserRowId, recoveredCount } from './rules';

const held = (delivery: PendingMsg['delivery'], uuid = 'u'): PendingMsg => ({ uuid, kind: 'user', text: 'hi', mode: 'steer', state: 'held', delivery });

describe('what a held message can do', () => {
  it('sends an uncertain message again only when Ben asks, as on the web', () => {
    expect(canSendAgain(held('uncertain'))).toBe(true);
    expect(canSendAgain(held('recovered'))).toBe(false);
    expect(canSendAgain(held('sent'))).toBe(false);
    expect(canSendAgain(held(undefined))).toBe(false);
  });

  it('counts the recovered messages Resume would send', () => {
    expect(recoveredCount([held('recovered', 'a'), held('uncertain', 'b'), held('recovered', 'c'), held('sent', 'd')])).toBe(2);
    expect(recoveredCount([])).toBe(0);
  });
});

describe('latestUserRowId', () => {
  it('is the newest user row, whatever order the rows come in', () => {
    expect(latestUserRowId([{ id: 3, kind: 'user' }, { id: 9, kind: 'assistant_text' }, { id: 7, kind: 'user' }, { id: 1, kind: 'user' }])).toBe(7);
  });

  it('is null when no user row is loaded', () => {
    expect(latestUserRowId([])).toBeNull();
    expect(latestUserRowId([{ id: 2, kind: 'tool_use' }])).toBeNull();
  });
});
