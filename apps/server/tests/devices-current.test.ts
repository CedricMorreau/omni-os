import { describe, expect, it } from 'vitest';
import type { DeviceRecord } from '@omni/shared/handoff.ts';
import { currentRecords } from '../sync/devices.ts';

const rec = (id: string, at: string, nodeId: string | null): DeviceRecord => ({
  id,
  name: 'omarchy',
  tailscale: nodeId ? { nodeId, dnsName: `${nodeId}.ts.net` } : null,
  at,
});

describe('currentRecords', () => {
  it('keeps only the newest record for a Tailscale node', () => {
    const old = rec('old', '2026-10-29T15:12:45.855Z', 'n1');
    const live = rec('new', '2026-11-01T12:54:33.064Z', 'n1');
    expect(currentRecords([old, live])).toEqual([live]);
    expect(currentRecords([live, old])).toEqual([live]);
  });

  it('keeps machines on different nodes and machines without a node', () => {
    const a = rec('a', '2026-10-24T07:26:29.445Z', 'n1');
    const b = rec('b', '2026-10-30T10:49:39.011Z', null);
    const c = rec('c', '2026-10-30T10:49:40.011Z', null);
    expect(currentRecords([a, b, c])).toEqual([a, b, c]);
  });

  it('breaks a tie on the same timestamp by id so every machine picks the same one', () => {
    const x = rec('x', '2026-11-01T00:00:00.000Z', 'n1');
    const y = rec('y', '2026-11-01T00:00:00.000Z', 'n1');
    expect(currentRecords([x, y])).toEqual([y]);
    expect(currentRecords([y, x])).toEqual([y]);
  });
});
