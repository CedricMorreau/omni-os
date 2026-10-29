import { describe, it, expect, beforeAll } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
  H.db.channels.create({ id: 'linked', name: 'Linked', kind: 'client', use_worktree: 0, base_dir: H.tmp });
});

const call = async (method: string, body?: unknown) => {
  const res = await app.request('/api/channels/linked', {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};

const productive = { label: 'Productive', url: 'https://app.productive.io/1-example/projects/100' };
const vercel = { label: 'Vercel', url: 'https://vercel.com/acme-team/acme' };

describe('channel quick links', () => {
  it('starts empty', async () => {
    expect((await call('GET')).body.links).toEqual([]);
  });

  it('saves, keeps and replaces the list in order', async () => {
    expect((await call('PATCH', { links: [productive, vercel] })).body.links).toEqual([productive, vercel]);
    expect((await call('PATCH', { notes: 'x' })).body.links).toEqual([productive, vercel]);
    expect((await call('GET')).body.links).toEqual([productive, vercel]);
    expect((await call('PATCH', { links: [vercel] })).body.links).toEqual([vercel]);
    expect((await call('PATCH', { links: [] })).body.links).toEqual([]);
  });

  it('refuses a link without a name or with an address that is not http or https', async () => {
    expect((await call('PATCH', { links: [{ label: ' ', url: 'https://example.com' }] })).status).toBe(400);
    expect((await call('PATCH', { links: [{ label: 'Mail', url: 'mailto:a@example.com' }] })).status).toBe(400);
    expect((await call('PATCH', { links: [{ label: 'Bad', url: 'example.com' }] })).status).toBe(400);
  });
});
