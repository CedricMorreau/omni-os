import { beforeAll, expect, it } from 'vitest';
import { startRunner } from './runner-boot.ts';

let H: Awaited<ReturnType<typeof startRunner>>;
let app: Awaited<typeof import('../app.ts')>['app'];

beforeAll(async () => {
  H = await startRunner();
  ({ app } = await import('../app.ts'));
});

const mcp = async (id: string, body: unknown) => {
  const res = await app.request(`/api/threads/${id}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

const live = async () => {
  const t = await H.start('THINK:1');
  await H.untilResults(t.id, 1);
  return t.id;
};

it('lists the live status of every MCP server of the thread', async () => {
  const id = await live();
  const r = await mcp(id, { action: 'status' });
  expect(r.status).toBe(200);
  expect(r.body.servers).toContainEqual({ name: 'claude.ai Acme', status: 'needs-auth', scope: 'claudeai' });
  expect(r.body.servers.find((s: any) => s.name === 'omni-threads')).toMatchObject({ status: 'connected' });
});

it('gives the sign-in link of a server that needs one', async () => {
  const id = await live();
  const r = await mcp(id, { action: 'authenticate', server: 'claude.ai Acme' });
  expect(r.body.auth_url).toBe('https://claude.ai/mcp/start-auth/claude.ai%20Acme');
});

it('switches a server off and on, and returns the new status', async () => {
  const id = await live();
  const off = await mcp(id, { action: 'disable', server: 'omni-threads' });
  expect(off.body.servers.find((s: any) => s.name === 'omni-threads').status).toBe('disabled');
  const on = await mcp(id, { action: 'enable', server: 'omni-threads' });
  expect(on.body.servers.find((s: any) => s.name === 'omni-threads').status).toBe('connected');
});

it('says what went wrong for a server the process does not know', async () => {
  const id = await live();
  const r = await mcp(id, { action: 'reconnect', server: 'nope' });
  expect(r).toMatchObject({ status: 502, body: { error: 'Server not found: nope' } });
});

it('refuses a thread with no running process', async () => {
  const t = H.db.threads.create({
    id: 'cold-1', channel_id: 'scratch', title: 'Cold', status: 'done', role: null, model: null, session_id: 'cold-1', cwd: H.tmp,
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });
  const r = await mcp(t.id, { action: 'status' });
  expect(r).toMatchObject({ status: 409, body: { error: 'The thread has no running process. Send a message to start it.' } });
});
