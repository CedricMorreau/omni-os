import type { ChannelWithRunning, ThreadStub } from '@omni/client-core';
import { describe, expect, it } from 'vitest';

import { channelSections, channelThreads, shortAgo, threadRow } from '../src/live/channel-model';

const NOW = Date.parse('2026-11-02T12:00:00Z');

function channel(over: Partial<ChannelWithRunning> & { id: string }): ChannelWithRunning {
  return {
    name: over.id,
    kind: 'client',
    archived: 0,
    running: 0,
    ...over,
  } as unknown as ChannelWithRunning;
}

function stub(over: Partial<ThreadStub> & { id: string }): ThreadStub {
  return {
    title: over.id,
    status: 'done',
    channel_id: 'c',
    created_at: '2026-11-02T11:00:00Z',
    updated_at: '2026-11-02T11:00:00Z',
    folder_id: null,
    source: 'manual',
    ...over,
  } as ThreadStub;
}

describe('channelSections', () => {
  it('lifts the Conductor out and groups the rest in the phone web order', () => {
    const model = channelSections([
      channel({ id: 'personal-1', kind: 'personal' }),
      channel({ id: 'conductor', kind: 'system', running: 1 }),
      channel({ id: 'client-1', kind: 'client' }),
      channel({ id: 'internal-1', kind: 'internal', running: 2 }),
    ]);
    expect(model.conductor?.id).toBe('conductor');
    expect(model.groups.map((g) => g.label)).toEqual(['Clients', 'Internal', 'Personal']);
    expect(model.groups.map((g) => g.channels.map((c) => c.id))).toEqual([['client-1'], ['internal-1'], ['personal-1']]);
    expect(model.listedCount).toBe(3);
    expect(model.running).toBe(3);
  });

  it('leaves out archived channels and empty groups', () => {
    const model = channelSections([channel({ id: 'old', archived: 1 }), channel({ id: 'p', kind: 'personal' })]);
    expect(model.groups).toEqual([{ label: 'Personal', channels: [expect.objectContaining({ id: 'p' })] }]);
    expect(model.listedCount).toBe(1);
    expect(model.conductor).toBeUndefined();
  });
});

describe('shortAgo', () => {
  it('uses the shortest honest unit', () => {
    expect(shortAgo(new Date(NOW - 10_000).toISOString(), NOW)).toBe('now');
    expect(shortAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5m');
    expect(shortAgo(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3h');
    expect(shortAgo(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2d');
  });

  it('shows a date past a week and nothing for a bad timestamp', () => {
    expect(shortAgo(new Date(NOW - 30 * 86_400_000).toISOString(), NOW)).not.toMatch(/[hdm]$/);
    expect(shortAgo('not a date', NOW)).toBe('');
  });
});

describe('threadRow', () => {
  it('names only the states worth a word and marks busy threads', () => {
    expect(threadRow(stub({ id: 'a', status: 'running' }), NOW)).toMatchObject({ busy: true, statusLabel: 'Running' });
    expect(threadRow(stub({ id: 'b', status: 'queued' }), NOW)).toMatchObject({ busy: true, statusLabel: 'Queued' });
    expect(threadRow(stub({ id: 'c', status: 'done' }), NOW)).toMatchObject({ busy: false, statusLabel: null });
    expect(threadRow(stub({ id: 'd', status: 'failed' }), NOW)).toMatchObject({ statusLabel: 'Failed' });
  });

  it('falls back to Untitled for a blank title', () => {
    expect(threadRow(stub({ id: 'e', title: '  ' }), NOW).title).toBe('  ');
    expect(threadRow(stub({ id: 'f', title: '' }), NOW).title).toBe('Untitled');
  });
});

describe('channelThreads', () => {
  it('splits ungrouped threads into active and recent and leaves out team members', () => {
    const model = channelThreads(
      channel({
        id: 'c',
        active: [stub({ id: 'run', status: 'running' }), stub({ id: 'team', status: 'running', source: 'team' })],
        recent: [stub({ id: 'old', status: 'done' })],
      }),
      NOW,
    );
    expect(model.active.map((r) => r.id)).toEqual(['run']);
    expect(model.recent.map((r) => r.id)).toEqual(['old']);
    expect(model.folders).toEqual([]);
  });

  it('moves folder threads into their folder, once, and drops folders with nothing in them', () => {
    const model = channelThreads(
      channel({
        id: 'c',
        active: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' })],
        recent: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' }), stub({ id: 'loose' })],
        folders: [
          { id: 'f1', name: 'Launch', collapsed: 0, threads: [stub({ id: 'in-folder', status: 'running', folder_id: 'f1' }), stub({ id: 'done-in', status: 'done', folder_id: 'f1' })] },
          { id: 'f2', name: 'Empty', collapsed: 1, threads: [] },
        ] as unknown as ChannelWithRunning['folders'],
      }),
      NOW,
    );
    expect(model.folders.map((f) => f.name)).toEqual(['Launch']);
    expect(model.folders[0]?.active.map((r) => r.id)).toEqual(['in-folder']);
    expect(model.folders[0]?.recent.map((r) => r.id)).toEqual(['done-in']);
    expect(model.recent.map((r) => r.id)).toEqual(['loose']);
    expect(model.active).toEqual([]);
  });
});
