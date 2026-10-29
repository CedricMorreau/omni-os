import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: typeof import('../db.ts');
let T: typeof import('../tickets.ts');

beforeAll(async () => {
  process.env.OMNI_DATA_DIR = mkdtempSync(join(tmpdir(), 'omni-tickets-'));
  process.env.HOME = mkdtempSync(join(tmpdir(), 'omni-tickets-home-'));
  db = await import('../db.ts');
  T = await import('../tickets.ts');
  db.channels.create({ id: 'acme', name: 'Acme', kind: 'client' });
});

const fakeStart = async ({ id }: { id: string }) =>
  db.threads.create({
    id, channel_id: 'acme', title: 'Ticket', status: 'done', role: 'ticket', model: null, session_id: id, cwd: '/tmp',
    branch: null, parent_id: null, task_id: null, source: 'manual', automation: null,
  });

const local = () => T.createTicket({ channel: 'acme', source: 'local', context: 'fix it' }, fakeStart);
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const at = (id: string, stage: number, gates: Partial<Record<'plan_ok' | 'client_ok' | 'go_ok', string>> = {}) =>
  T.tickets.update(id, { stage, ...gates });
const routed = async (route = ALL) => {
  const { thread_id } = await local();
  T.setRoute(thread_id, route);
  return thread_id;
};

describe('creating tickets', () => {
  it('starts at intake and takes the Productive task number as ref', async () => {
    const t = await T.createTicket({ channel: 'acme', source: 'productive', link: 'https://app.productive.io/1-example/tasks/1060' }, fakeStart);
    expect(t).toMatchObject({ ref: '#1060', stage: 0, stage_name: 'Intake', route: null, round: 1, badge: 'check' });
  });

  it('reads the task number from the link Productive shows in the browser', async () => {
    const t = await T.createTicket({ channel: 'acme', source: 'productive', link: 'https://app.productive.io/1-example/projects/100/tasks/task/18506533?filter=OTM4MjY5' }, fakeStart);
    expect(t.ref).toBe('#18506533');
    const numbered = await T.createTicket({ channel: 'acme', source: 'productive', ref: '997', link: 'https://app.productive.io/1/projects/2/tasks/task/18506533' }, fakeStart);
    expect(numbered.ref).toBe('#997');
  });

  it('numbers local and Slack work L-001, L-002', async () => {
    const a = await local();
    const b = await T.createTicket({ channel: 'acme', source: 'slack', link: 'https://example.slack.com/archives/C1/p1' }, fakeStart);
    expect([a.ref, b.ref]).toEqual(['L-001', 'L-002']);
  });

  it('refuses a Productive ticket without a task link and leaves no row', async () => {
    const before = T.tickets.all().length;
    await expect(T.createTicket({ channel: 'acme', source: 'productive', link: 'https://example.com' }, fakeStart)).rejects.toThrow(/task link/);
    expect(T.tickets.all()).toHaveLength(before);
  });

  it('removes the row when the thread cannot start', async () => {
    const before = T.tickets.all().length;
    await expect(T.createTicket({ channel: 'acme', source: 'local' }, async () => { throw new Error('no worktree'); })).rejects.toThrow('no worktree');
    expect(T.tickets.all()).toHaveLength(before);
  });
});

describe('routes', () => {
  it('waits for a confirmed route: a proposal asks the user, the confirmed route starts at its first stage', async () => {
    const { thread_id: id } = await local();
    expect(() => T.moveTicket(id, 1)).toThrow(/no route yet/);
    T.proposeRoute(id, [3, 4, 9, 10, 3], { '1': 'tiny copy fix', '2': 'no plan needed' });
    expect(T.ticketView(T.tickets.get(id)!)).toMatchObject({ badge: 'decide', route_proposal: { stages: [3, 4, 9, 10], reasons: { '1': 'tiny copy fix' } } });
    expect(T.setRoute(id, [3, 4, 9, 10])).toMatchObject({ stage: 3, route: [3, 4, 9, 10], route_proposal: null, skipped: [1, 2, 5, 6, 7, 8] });
  });

  it('moves only to the next stage on the route', async () => {
    const id = await routed([1, 3, 5]);
    expect(() => T.moveTicket(id, 5)).toThrow(/next stage on its route is stage 3/);
    expect(() => T.moveTicket(id, 2)).toThrow(/next stage/);
    expect(T.moveTicket(id, 3).stage).toBe(3);
    expect(() => T.moveTicket(id, 1)).toThrow(/next stage/);
  });

  it('lets the user change the route on the way', async () => {
    const id = await routed([1, 3, 4]);
    T.setRoute(id, [1, 3, 4, 5, 9, 10]);
    T.moveTicket(id, 3);
    T.moveTicket(id, 4);
    expect(T.moveTicket(id, 5).stage).toBe(5);
  });

  it('refuses an empty route or a stage outside 1 to 10', async () => {
    const { thread_id: id } = await local();
    expect(() => T.setRoute(id, [])).toThrow(/one or more stages/);
    expect(() => T.proposeRoute(id, [0, 3])).toThrow(/one or more stages/);
    expect(() => T.setRoute(id, [11])).toThrow(/one or more stages/);
  });
});

describe('gates', () => {
  it('holds the next stage until the plan is approved when the route has a plan', async () => {
    const id = await routed();
    T.moveTicket(id, 2);
    expect(() => T.moveTicket(id, 3)).toThrow(/plan approval/);
    T.recordGate(id, 'plan', 'looks good, go ahead');
    expect(T.moveTicket(id, 3).stage).toBe(3);
  });

  it('holds the deploy until the client approved, unless the route leaves client approval out', async () => {
    const withClient = await routed([7, 8, 9]);
    T.moveTicket(withClient, 8);
    expect(() => T.moveTicket(withClient, 9)).toThrow(/client approval/);
    T.recordGate(withClient, 'client', 'the client approved in Productive');
    expect(T.moveTicket(withClient, 9).stage).toBe(9);
    const without = await routed([5, 9]);
    expect(T.moveTicket(without, 9).stage).toBe(9);
  });

  it('holds the end of the deploy until the go', async () => {
    const id = await routed([9, 10]);
    expect(() => T.moveTicket(id, 10)).toThrow(/go/);
    T.recordGate(id, 'go', 'go');
    expect(T.moveTicket(id, 10).stage).toBe(10);
  });

  it('opens a gate only at its own stage, and only with the words', async () => {
    const id = await routed([1, 2]);
    expect(() => T.recordGate(id, 'go', 'go')).toThrow(/stage 9/);
    T.moveTicket(id, 2);
    expect(() => T.recordGate(id, 'plan', '  ')).toThrow(/quote/);
  });

  it('closes at the last stage of the route', async () => {
    const id = await routed([3, 4]);
    expect(() => T.closeTicket(id)).toThrow(/last stage of its route, stage 4/);
    T.moveTicket(id, 4);
    expect(T.closeTicket(id).closed_at).not.toBeNull();
  });
});

describe('rounds', () => {
  it('sends client feedback back to the first build stage and clears the client approval and the go', async () => {
    const id = await routed([1, 3, 4, 5, 7, 8, 9, 10]);
    at(id, 9, { plan_ok: 'yes', client_ok: 'ok', go_ok: 'go' });
    expect(T.clientFeedback(id)).toMatchObject({ stage: 3, round: 2, plan_ok: 'yes', client_ok: null, go_ok: null });
  });
});

describe('badges', () => {
  it('sorts go, decide, check, working, client', async () => {
    const ids = await Promise.all([routed(), routed(), routed(), routed(), routed()]);
    at(ids[0], 8);
    db.threads.update(ids[1], { status: 'running' });
    at(ids[2], 6);
    at(ids[3], 2);
    at(ids[4], 9, { client_ok: 'ok' });
    const order = T.listTickets().filter((t) => ids.includes(t.thread_id)).map((t) => t.badge);
    expect(order).toEqual(['go', 'decide', 'check', 'working', 'client']);
  });

  it('hides closed tickets unless asked', async () => {
    const id = await routed([10]);
    T.closeTicket(id);
    expect(T.listTickets().some((t) => t.thread_id === id)).toBe(false);
    expect(T.listTickets({ closed: true }).find((t) => t.thread_id === id)?.badge).toBe('closed');
  });
});

describe('roles per stage', () => {
  it('lists the roles set up for the current stage, takes one on confirmation, and drops it on the next move', async () => {
    const { saveRole } = await import('../crew.ts');
    saveRole('debugger', { name: 'Debugger', description: 'Root cause first', skills: ['superpowers:systematic-debugging'], stages: [3], charter: 'Find the root cause.' });
    saveRole('builder-x', { name: 'Builder', description: '', skills: ['superpowers:executing-plans'], stages: [3, 4], charter: 'Build it.' });
    const id = await routed([1, 3, 4]);
    expect(T.rolesForStage(1)).toEqual([]);
    T.moveTicket(id, 3);
    expect(T.rolesForStage(3).map((r) => r.id).sort()).toEqual(['builder-x', 'debugger']);
    expect(() => T.useRole(id, 'debugger', ' ')).toThrow(/quote/);
    expect(() => T.useRole(id, 'ticket', 'yes')).toThrow(/no role/);
    const used = T.useRole(id, 'debugger', 'yes, debug it');
    expect(used.role).toEqual({ id: 'debugger', name: 'Debugger', skills: ['superpowers:systematic-debugging'], instructions: 'Find the root cause.' });
    expect(used.ticket.role).toBe('debugger');
    expect(T.moveTicket(id, 4).role).toBeNull();
  });
});

describe('tickets from the composer and from existing threads', () => {
  it('finds the source in the text the user typed', () => {
    expect(T.sourceFromText('please do https://app.productive.io/1-example/projects/100/tasks/task/123?filter=x now')).toEqual({ source: 'productive', link: 'https://app.productive.io/1-example/projects/100/tasks/task/123?filter=x' });
    expect(T.sourceFromText('see https://example.slack.com/archives/C1/p2')).toMatchObject({ source: 'slack' });
    expect(T.sourceFromText('fix the footer')).toEqual({ source: 'local', link: null });
  });

  it('turns a plain thread into a ticket at intake, once', async () => {
    const thread = await fakeStart({ id: 'plain-1' });
    db.threads.update(thread.id, { role: null });
    const { ticket, prompt } = T.attachTicket(thread.id, { source: 'productive', link: 'https://app.productive.io/1/projects/2/tasks/task/20706074', ref: '1053' });
    expect(ticket).toMatchObject({ ref: '#1053', stage: 0, source: 'productive' });
    expect(db.threads.get(thread.id)?.role).toBe('ticket');
    expect(prompt).toContain('done earlier in this thread');
    expect(() => T.attachTicket(thread.id, { source: 'local' })).toThrow(/ticket already/);
  });

  it('sets the ticket title with the route proposal', async () => {
    const { thread_id: id } = await local();
    T.proposeRoute(id, [3, 4], {}, 'Product specifications');
    expect(T.ticketView(T.tickets.get(id)!).title).toBe('Product specifications');
  });
});
