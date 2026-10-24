import { api, errorText } from './api.ts';

/** POST /api/grokbot for one thread. The server reads the thread's text and adds its channel and thread ids. */
export async function sendThreadToGrokBot(threadId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api.post<{ ok: boolean }>('/grokbot', { thread_id: threadId });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}
