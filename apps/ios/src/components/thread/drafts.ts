import { useSyncExternalStore } from 'react';

import { createStore } from '../../live/store';

/**
 * What Ben has typed in each thread's composer. It lives at module level, so a draft survives leaving the thread and
 * coming back, and so a failed message's Edit can put its text back from outside the composer.
 */
const drafts = createStore<Readonly<Record<string, string>>>({});

export function getDraft(threadId: string): string {
  return drafts.get()[threadId] ?? '';
}

export function setDraft(threadId: string, text: string): void {
  drafts.set((all) => {
    if ((all[threadId] ?? '') === text) return all;
    const { [threadId]: _gone, ...rest } = all;
    return text ? { ...rest, [threadId]: text } : rest;
  });
}

/** Puts text back in front of whatever has been typed since, so neither is lost. */
export function restoreDraft(threadId: string, text: string): void {
  const typed = getDraft(threadId);
  setDraft(threadId, typed.trim() ? `${text}\n\n${typed}` : text);
}

export function useDraft(threadId: string): string {
  return useSyncExternalStore(drafts.subscribe, () => getDraft(threadId));
}
