import type { ChannelWithRunning, OmniApi } from '@omni/client-core';

import type { ChannelsState } from './hub';
import type { Store } from './store';

export interface FolderCollapseOptions {
  api: Pick<OmniApi, 'setFolderCollapsed'> | null;
  withAuth: <T>(run: () => Promise<T>) => Promise<T>;
  channels: Store<ChannelsState>;
  /** Refetches the list once the server has the new state, so a list fetched before the change cannot undo it. */
  refresh: () => Promise<void>;
}

function withCollapsed(channels: readonly ChannelWithRunning[], folderId: string, collapsed: boolean): readonly ChannelWithRunning[] {
  return channels.map((c) =>
    c.folders?.some((f) => f.id === folderId)
      ? { ...c, folders: c.folders.map((f) => (f.id === folderId ? { ...f, collapsed: collapsed ? 1 : 0 } : f)) }
      : c,
  );
}

function collapsedOf(channels: readonly ChannelWithRunning[] | null, folderId: string): boolean | null {
  for (const c of channels ?? []) {
    const folder = c.folders?.find((f) => f.id === folderId);
    if (folder) return !!folder.collapsed;
  }
  return null;
}

/**
 * Opens and closes a folder. The server keeps the state, so every client's list follows. The row answers at once and
 * goes back if the server refuses. Resolves to the failure's message, or null on success.
 */
export function createFolderCollapse({ api, withAuth, channels, refresh }: FolderCollapseOptions) {
  return async function setFolderCollapsed(folderId: string, collapsed: boolean): Promise<string | null> {
    if (!api) return 'Not paired';
    const before = collapsedOf(channels.get().channels, folderId);
    if (before === null) return 'That folder is gone';
    const apply = (value: boolean) => channels.set((s) => (s.channels ? { ...s, channels: withCollapsed(s.channels, folderId, value) } : s));
    apply(collapsed);
    try {
      await withAuth(() => api.setFolderCollapsed(folderId, collapsed));
    } catch (e) {
      if (collapsedOf(channels.get().channels, folderId) === collapsed) apply(before);
      return e instanceof Error && e.message ? e.message : 'Something went wrong';
    }
    void refresh();
    return null;
  };
}
