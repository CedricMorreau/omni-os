import { parsePayload, type UserP } from '@omni/shared/transcript-fold.ts';
import type { EventRow } from '../../api.ts';

const BEN = new Set([undefined, 'ben', 'manual', 'capture']);

export const sentTexts = (events: readonly EventRow[]) =>
  events
    .filter((e) => e.kind === 'user')
    .map((e) => parsePayload<UserP>(e))
    .filter((p) => BEN.has(p.source) && p.text?.trim())
    .map((p) => p.text);

export function recallStep(sent: readonly string[], at: number | null, dir: -1 | 1): number | null {
  if (dir === 1) return at === null || at + 1 >= sent.length ? null : at + 1;
  const back = (at ?? sent.length) - 1;
  return back < 0 ? at : back;
}
