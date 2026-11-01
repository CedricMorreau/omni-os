import { useCallback, useEffect, useState } from 'react';
import { api, type PRSummary, type Thread } from '../../api.ts';

export { OPEN_PR_PROMPT } from '../../thread-glance.ts';

/**
 * A thread branch's PR and every PR from it, from GET /threads/:id/pr: again when a turn ends (it may have opened the
 * PR), and every minute to catch a merge. Undefined until the first answer, and for a thread with no branch. `eager`
 * also asks once mid-turn, for a screen that has nothing else to show.
 */
export function useThreadPR(thread: Pick<Thread, 'id' | 'branch'> | null, slotBusy: boolean, eager = false) {
  const [data, setData] = useState<{ pr: PRSummary | null; prs: PRSummary[] } | undefined>(undefined);
  const id = thread?.branch ? thread.id : null;
  const load = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.get<{ pr: PRSummary | null; prs?: PRSummary[] }>(`/threads/${encodeURIComponent(id)}/pr`);
      setData({ pr: r.pr, prs: r.prs ?? (r.pr ? [r.pr] : []) });
    } catch {
      setData((prev) => prev ?? { pr: null, prs: [] });
    }
  }, [id]);
  useEffect(() => {
    if (!slotBusy) void load();
  }, [load, slotBusy, thread?.branch]);
  // Idle, the effect above already asked.
  useEffect(() => {
    if (eager && slotBusy) void load();
  }, [eager, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const tick = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 60_000);
    return () => clearInterval(tick);
  }, [load]);
  return data;
}
