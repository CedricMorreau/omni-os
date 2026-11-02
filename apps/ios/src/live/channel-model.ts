import type { ChannelWithRunning, ThreadStub } from '@omni/client-core';

/** The channel list's groups, in the order the phone web app shows them. */
const GROUPS: readonly { label: string; kinds: readonly string[] }[] = [
  { label: 'Clients', kinds: ['client'] },
  { label: 'Internal', kinds: ['internal', 'system'] },
  { label: 'Personal', kinds: ['personal'] },
];

export interface ChannelSections {
  /** The Conductor, shown above the groups. Undefined until the list loads. */
  conductor: ChannelWithRunning | undefined;
  groups: { label: string; channels: ChannelWithRunning[] }[];
  /** Live channels other than the Conductor. */
  listedCount: number;
  /** Running threads across every channel, the Conductor included. */
  running: number;
}

export function channelSections(channels: readonly ChannelWithRunning[]): ChannelSections {
  const listed = channels.filter((c) => !c.archived && c.id !== 'conductor');
  return {
    conductor: channels.find((c) => c.id === 'conductor'),
    groups: GROUPS.map((g) => ({ label: g.label, channels: listed.filter((c) => g.kinds.includes(c.kind)) })).filter((g) => g.channels.length > 0),
    listedCount: listed.length,
    running: channels.reduce((n, c) => n + (c.running || 0), 0),
  };
}

/** A thread as a list row. `busy` is the running or queued state, which the list puts first. */
export interface ThreadRow {
  id: string;
  title: string;
  status: ThreadStub['status'];
  busy: boolean;
  /** The word after the title for a state worth naming. Null for a finished, done thread. */
  statusLabel: string | null;
  /** "now", "5m", "3h", "2d". */
  ago: string;
}

const STATUS_LABEL: Partial<Record<ThreadStub['status'], string>> = {
  queued: 'Queued',
  running: 'Running',
  failed: 'Failed',
  stopped: 'Stopped',
};

/** Short relative time: "now", "5m", "3h", "2d". Clocks past a week show the date. */
export function shortAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, now - t);
  if (diff < 45_000) return 'now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.round(diff / 86_400_000)}d`;
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function threadRow(t: ThreadStub, now: number): ThreadRow {
  return {
    id: t.id,
    title: t.title || 'Untitled',
    status: t.status,
    busy: t.status === 'running' || t.status === 'queued',
    statusLabel: STATUS_LABEL[t.status] ?? null,
    ago: shortAgo(t.updated_at ?? t.created_at, now),
  };
}

export interface FolderSection {
  id: string;
  name: string;
  collapsed: boolean;
  active: ThreadRow[];
  recent: ThreadRow[];
}

/** One channel's threads: busy and finished, ungrouped and by folder. Team members are left out, as on the phone web. */
export interface ChannelThreads {
  active: ThreadRow[];
  recent: ThreadRow[];
  folders: FolderSection[];
}

export function channelThreads(channel: ChannelWithRunning, now: number): ChannelThreads {
  const seen = new Set<string>();
  const fresh = (stubs: readonly ThreadStub[] | undefined): ThreadStub[] =>
    (stubs ?? []).filter((t) => {
      if (t.source === 'team' || seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

  const folders: FolderSection[] = (channel.folders ?? []).map((f) => {
    const rows = fresh(f.threads).map((t) => threadRow(t, now));
    return {
      id: f.id,
      name: f.name,
      collapsed: !!f.collapsed,
      active: rows.filter((r) => r.busy),
      recent: rows.filter((r) => !r.busy),
    };
  });

  const ungrouped = fresh([...(channel.active ?? []), ...(channel.recent ?? [])]).filter((t) => !t.folder_id);
  const rows = ungrouped.map((t) => threadRow(t, now));
  return {
    active: rows.filter((r) => r.busy),
    recent: rows.filter((r) => !r.busy),
    folders: folders.filter((f) => f.active.length + f.recent.length > 0),
  };
}
