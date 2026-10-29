import { beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let app: typeof import('../app.ts')['app'];
let rolesDir: () => string;

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-roles-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'omni-roles-home-'));
  await import('../db.ts');
  ({ app } = await import('../app.ts'));
  ({ rolesDir } = await import('../crew.ts'));
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (await res.json()) as any };
};

const reviewer = { id: 'reviewer', name: 'Reviewer', description: 'Checks the PR', skills: ['ponytail:ponytail-review', 'code-review'], stages: [5], charter: 'Review only the diff.' };

describe('roles', () => {
  it('creates a role in the memory roles folder and lists it with its skills and stages', async () => {
    const made = await call('POST', '/crew', reviewer);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ id: 'reviewer', name: 'Reviewer', skills: reviewer.skills, stages: [5], charter: 'Review only the diff.', source: 'yours' });
    expect(readFileSync(join(rolesDir(), 'reviewer.md'), 'utf8')).toContain('ponytail:ponytail-review');
    expect((await call('GET', '/crew')).body.find((r: any) => r.id === 'reviewer').stages).toEqual([5]);
    expect((await call('POST', '/crew', reviewer)).status).toBe(409);
  });

  it('renames a role and changes its skills, stages and instructions', async () => {
    const changed = await call('PUT', '/crew/reviewer', { ...reviewer, name: 'PR reviewer', skills: ['code-review'], stages: [5, 9], charter: 'New text.' });
    expect(changed.body).toMatchObject({ id: 'reviewer', name: 'PR reviewer', skills: ['code-review'], stages: [5, 9], charter: 'New text.' });
  });

  it('deletes your own role, never the ticket or conductor role', async () => {
    expect((await call('DELETE', '/crew/ticket')).status).toBe(409);
    expect((await call('DELETE', '/crew/conductor')).status).toBe(409);
    expect((await call('DELETE', '/crew/reviewer')).status).toBe(200);
    expect(existsSync(join(rolesDir(), 'reviewer.md'))).toBe(false);
    expect((await call('DELETE', '/crew/reviewer')).status).toBe(404);
  });

  it('refuses a bad id or a stage outside 1 to 10', async () => {
    expect((await call('POST', '/crew', { ...reviewer, id: 'Bad Id' })).status).toBe(400);
    expect((await call('POST', '/crew', { ...reviewer, id: 'late', stages: [11] })).status).toBe(400);
  });
});
