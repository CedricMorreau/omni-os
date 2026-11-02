import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let usage: typeof import('../usage.ts');

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-usage-fable-'));
  usage = await import('../usage.ts');
});

const now = Math.floor(Date.now() / 1000);
const at = new Date().toISOString();

describe('Fable week', () => {
  it('keeps the last Fable reading when a reading from another model has none', () => {
    usage.recordUsage('claude-code', { seven_day: { utilization: 0.4, resetsAt: now + 3600 }, fable_week: { utilization: 0.64, resetsAt: now + 3600 }, updated_at: at });
    usage.recordUsage('claude-code', { seven_day: { utilization: 0.5, resetsAt: now + 3600 }, updated_at: at });
    expect(usage.usageFor('claude-code')).toMatchObject({ seven_day: { utilization: 0.5 }, fable_week: { utilization: 0.64 } });
  });

  it('drops the Fable reading once its week reset', () => {
    usage.recordUsage('claude-code', { fable_week: { utilization: 0.9, resetsAt: now - 60 }, updated_at: at });
    usage.recordUsage('claude-code', { seven_day: { utilization: 0.1, resetsAt: now + 3600 }, updated_at: at });
    expect(usage.usageFor('claude-code')?.fable_week).toBeUndefined();
  });
});
