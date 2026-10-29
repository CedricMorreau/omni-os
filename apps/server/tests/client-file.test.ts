import { beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let clientLines: typeof import('../runner/prompts.ts').clientLines;
let clientFile: typeof import('../config.ts').clientFile;

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-client-file-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'omni-home-'));
  ({ clientLines } = await import('../runner/prompts.ts'));
  ({ clientFile } = await import('../config.ts'));
});

const channel = (id: string) => ({ id, name: id.toUpperCase(), kind: 'client' }) as Parameters<typeof clientLines>[0];

describe('client file', () => {
  it('puts the channel file from the home memory folder into the instructions', () => {
    const file = clientFile('acme');
    expect(file).toBe(join(process.env.HOME!, '.claude/projects', process.env.HOME!.replace(/[^a-zA-Z0-9]/g, '-'), 'memory/clients/acme.md'));
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, '## Deploy\nMerge develop into main.\n');
    const text = clientLines(channel('acme')).join('\n');
    expect(text).toContain('## Client file: ACME');
    expect(text).toContain('Merge develop into main.');
    expect(text).toContain('Never write a password');
  });

  it('adds nothing for a channel without a file', () => {
    expect(clientLines(channel('globex'))).toEqual([]);
  });
});
