import { describe, expect, it } from 'vitest';
import { isTransientStatus } from '../src/poll-retry.ts';

describe('a sign-in poll that failed', () => {
  it('tries again after a network error or a proxy gateway error', () => {
    for (const s of [0, 502, 503, 504]) expect(isTransientStatus(s)).toBe(true);
  });

  it('stops on an answer from the server', () => {
    for (const s of [400, 401, 404, 409, 429, 500]) expect(isTransientStatus(s)).toBe(false);
  });
});
