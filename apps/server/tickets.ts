import { randomUUID } from 'node:crypto';
import { db, needsYou, threads, type NeedsYouBlocker, type Thread } from './db.ts';
import { now } from './db/connection.ts';
import { PROTECTED_ROLES, getCrew, listCrew } from './crew.ts';

export const STAGES = ['Research', 'Build plan', 'Execute', 'Test', 'Review', 'Manual test', 'Preview + QA note', 'Client approval', 'Deploy', 'Closing'] as const;
const DEPLOY = 9;
const CLOSING = 10;
const CLIENT = 8;
const PREVIEW = 7;
export const SOURCES = ['productive', 'slack', 'local'] as const;
export const GATES = ['plan', 'client', 'go'] as const;
export const DRAFT_KINDS = ['qa', 'answer', 'closing'] as const;
export const BADGES = ['go', 'decide', 'check', 'working', 'client', 'closed'] as const;

export type Source = (typeof SOURCES)[number];
export type Gate = (typeof GATES)[number];
export type DraftKind = (typeof DRAFT_KINDS)[number];
export type Badge = (typeof BADGES)[number];

export interface Ticket {
  thread_id: string;
  channel_id: string;
  ref: string;
  source: Source;
  link: string | null;
  context: string | null;
  stage: number;
  stage_at: string;
  skipped: number[];
  round: number;
  plan_ok: string | null;
  client_ok: string | null;
  go_ok: string | null;
  draft_kind: DraftKind | null;
  draft: string | null;
  role: string | null;
  route: number[] | null;
  route_proposal: RouteProposal | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouteProposal {
  stages: number[];
  reasons: Record<string, string>;
}

export class TicketError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

const json = (v: string | null) => (v ? JSON.parse(v) : null);
const parse = (r: any): Ticket | undefined => (r ? { ...r, skipped: JSON.parse(r.skipped), route: json(r.route), route_proposal: json(r.route_proposal) } : undefined);

export const tickets = {
  get: (threadId: string) => parse(db.prepare('SELECT * FROM tickets WHERE thread_id = ?').get(threadId)),
  all: () => db.prepare('SELECT * FROM tickets ORDER BY created_at').all().map((r) => parse(r)!),
  insert(t: Pick<Ticket, 'thread_id' | 'channel_id' | 'ref' | 'source' | 'link' | 'context'>) {
    const at = now();
    db.prepare(
      'INSERT INTO tickets (thread_id, channel_id, ref, source, link, context, stage, stage_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
    ).run(t.thread_id, t.channel_id, t.ref, t.source, t.link, t.context, at, at, at);
    return tickets.get(t.thread_id)!;
  },
  update(threadId: string, patch: Partial<Omit<Ticket, 'thread_id' | 'created_at' | 'updated_at'>>) {
    const fields = { ...patch, updated_at: now() } as Record<string, unknown>;
    if (patch.skipped) fields.skipped = JSON.stringify(patch.skipped);
    if ('route' in patch) fields.route = patch.route ? JSON.stringify(patch.route) : null;
    if ('route_proposal' in patch) fields.route_proposal = patch.route_proposal ? JSON.stringify(patch.route_proposal) : null;
    const keys = Object.keys(fields);
    db.prepare(`UPDATE tickets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE thread_id = ?`).run(
      ...(keys.map((k) => fields[k]) as (string | number | null)[]),
      threadId,
    );
    return tickets.get(threadId)!;
  },
  remove: (threadId: string) => db.prepare('DELETE FROM tickets WHERE thread_id = ?').run(threadId),
};

const open = (threadId: string) => {
  const t = tickets.get(threadId);
  if (!t) throw new TicketError(`thread ${threadId} has no ticket`, 404);
  if (t.closed_at) throw new TicketError(`ticket ${t.ref} is closed`, 409);
  return t;
};

const stageName = (n: number) => (n === 0 ? 'intake' : `stage ${n} (${STAGES[n - 1]})`);

export function ticketRef(source: Source, link: string | null) {
  if (source === 'productive') {
    const id = link?.match(/\/tasks\/(?:task\/)?(\d+)/)?.[1];
    if (!id) throw new TicketError('a Productive ticket needs its task link, like https://app.productive.io/.../tasks/123');
    return `#${id}`;
  }
  const taken = tickets.all().map((t) => Number(t.ref.match(/^L-(\d+)$/)?.[1] ?? 0));
  return `L-${String(Math.max(0, ...taken) + 1).padStart(3, '0')}`;
}

export function moveTicket(threadId: string, to: number) {
  const t = open(threadId);
  if (!t.route) throw new TicketError(`${t.ref} has no route yet. Propose one with ticket_propose_route and wait for the user to confirm it.`, 409);
  const next = t.route.find((n) => n > t.stage);
  if (to !== next)
    throw new TicketError(
      next ? `${t.ref} is at ${stageName(t.stage)}. The next stage on its route is ${stageName(next)}. Client feedback goes through ticket_feedback.` : `${t.ref} is at the last stage of its route. Close it with ticket_close.`,
    );
  if (t.stage === 2 && !t.plan_ok) throw new TicketError(`${t.ref} needs plan approval from the user before it leaves ${stageName(2)}`, 409);
  if (t.route.includes(CLIENT) && to >= DEPLOY && !t.client_ok) throw new TicketError(`${t.ref} needs client approval, or the user waives it, before ${stageName(DEPLOY)}`, 409);
  if (t.stage === DEPLOY && !t.go_ok) throw new TicketError(`${t.ref} needs the user's go before the deploy is done`, 409);
  return tickets.update(threadId, { stage: to, stage_at: now(), draft_kind: null, draft: null, role: null });
}

const checkStages = (stages: number[]) => {
  const list = [...new Set(stages)].sort((a, b) => a - b);
  if (!list.length || list.some((n) => !Number.isInteger(n) || n < 1 || n > STAGES.length)) throw new TicketError(`a route is one or more stages from 1 to ${STAGES.length}`);
  return list;
};

const unrouted = (route: number[]) => STAGES.map((_, i) => i + 1).filter((n) => !route.includes(n));

export function proposeRoute(threadId: string, stages: number[], reasons: Record<string, string> = {}) {
  open(threadId);
  return tickets.update(threadId, { route_proposal: { stages: checkStages(stages), reasons } });
}

export function setRoute(threadId: string, stages: number[]) {
  const t = open(threadId);
  const route = checkStages(stages);
  const start = t.stage === 0 ? { stage: route[0], stage_at: now() } : {};
  return tickets.update(threadId, { route, route_proposal: null, skipped: unrouted(route), ...start });
}

export function recordGate(threadId: string, gate: Gate, words: string) {
  const t = open(threadId);
  const said = words.trim();
  if (!said) throw new TicketError('quote the words the user used to approve');
  const at: Record<Gate, number[]> = { plan: [2], client: [PREVIEW, CLIENT], go: [DEPLOY] };
  if (!at[gate].includes(t.stage)) throw new TicketError(`the ${gate} gate opens at ${at[gate].map(stageName).join(' or ')}; ${t.ref} is at ${stageName(t.stage)}`, 409);
  return tickets.update(threadId, { [`${gate}_ok`]: said });
}

export function saveDraft(threadId: string, kind: DraftKind, text: string) {
  open(threadId);
  return tickets.update(threadId, { draft_kind: kind, draft: text.trim() || null });
}

export function clientFeedback(threadId: string) {
  const t = open(threadId);
  if (t.stage < PREVIEW) throw new TicketError(`client feedback starts a new round from ${stageName(PREVIEW)} or later; ${t.ref} is at ${stageName(t.stage)}`, 409);
  const back = (t.route ?? []).find((n) => n >= 3 && n < PREVIEW) ?? t.stage;
  return tickets.update(threadId, { stage: back, stage_at: now(), round: t.round + 1, client_ok: null, go_ok: null, draft_kind: null, draft: null, role: null });
}

export function closeTicket(threadId: string) {
  const t = open(threadId);
  const last = t.route?.at(-1) ?? CLOSING;
  if (t.stage !== last) throw new TicketError(`${t.ref} closes at the last stage of its route, ${stageName(last)}; it is at ${stageName(t.stage)}`, 409);
  return tickets.update(threadId, { closed_at: now() });
}

export function badgeFor(t: Ticket, thread: Thread | undefined, blockers: NeedsYouBlocker[] = []): Badge {
  if (t.closed_at) return 'closed';
  if (thread?.status === 'running' || thread?.status === 'queued') return 'working';
  if (blockers.some((b) => b.kind === 'question')) return 'decide';
  if (t.route_proposal) return 'decide';
  if (t.stage === DEPLOY && !t.go_ok) return 'go';
  if (t.stage === 2 && !t.plan_ok) return 'decide';
  if (t.stage === CLIENT) return 'client';
  return 'check';
}

const DAY = 86_400_000;

export function ticketView(t: Ticket, thread = threads.get(t.thread_id), blockers?: NeedsYouBlocker[]) {
  const badge = badgeFor(t, thread, blockers ?? needsYou(undefined, t.thread_id).items[0]?.blockers);
  return {
    thread_id: t.thread_id,
    ref: t.ref,
    title: thread?.title ?? t.ref,
    channel: t.channel_id,
    source: t.source,
    link: t.link,
    stage: t.stage,
    stage_name: t.stage === 0 ? 'Intake' : STAGES[t.stage - 1],
    skipped: t.skipped,
    round: t.round,
    badge,
    waiting_days: badge === 'client' ? Math.floor((Date.now() - Date.parse(t.stage_at)) / DAY) : null,
    gates: { plan: t.plan_ok, client: t.client_ok, go: t.go_ok },
    draft: t.draft ? { kind: t.draft_kind, text: t.draft } : null,
    role: t.role,
    route: t.route,
    route_proposal: t.route_proposal,
    thread_status: thread?.status ?? null,
    updated_at: t.updated_at,
    closed_at: t.closed_at,
  };
}

export type TicketView = ReturnType<typeof ticketView>;

export function listTickets(opts: { channel?: string; closed?: boolean } = {}) {
  const blockers = new Map(needsYou().items.map((i) => [i.thread.id, i.blockers]));
  return tickets
    .all()
    .filter((t) => (!opts.channel || t.channel_id === opts.channel) && (opts.closed || !t.closed_at))
    .map((t) => ticketView(t, threads.get(t.thread_id), blockers.get(t.thread_id) ?? []))
    .sort((a, b) => BADGES.indexOf(a.badge) - BADGES.indexOf(b.badge) || b.updated_at.localeCompare(a.updated_at));
}

export interface NewTicket {
  channel: string;
  source: Source;
  link?: string | null;
  context?: string | null;
  title?: string | null;
  ref?: string | null;
}

export function ticketBrief(ref: string, input: NewTicket) {
  return [
    `New ticket ${ref} (${input.source}).`,
    input.link ? `Link: ${input.link}` : null,
    input.context?.trim() ? `Context from the user:\n${input.context.trim()}` : null,
    'Start with intake: read the ticket from the link, then propose its route with ticket_propose_route.',
  ]
    .filter(Boolean)
    .join('\n\n');
}

export async function createTicket(input: NewTicket, start: (thread: { id: string; prompt: string }) => Promise<Thread>) {
  if (input.source !== 'local' && !input.link?.trim()) throw new TicketError(`a ${input.source} ticket needs its link`);
  const link = input.source === 'local' ? null : input.link!.trim();
  const ref = input.ref?.trim().match(/^#?\d+$/) ? `#${input.ref.trim().replace(/^#/, '')}` : ticketRef(input.source, link);
  const id = randomUUID();
  tickets.insert({ thread_id: id, channel_id: input.channel, ref, source: input.source, link, context: input.context?.trim() || null });
  try {
    await start({ id, prompt: ticketBrief(ref, input) });
  } catch (e) {
    tickets.remove(id);
    throw e;
  }
  return ticketView(tickets.get(id)!);
}

export function rolesForStage(stage: number) {
  return listCrew()
    .filter((r) => r.stages.includes(stage) && !PROTECTED_ROLES.includes(r.id))
    .map((r) => ({ id: r.id, name: r.name, description: r.description, skills: r.skills }));
}

export function useRole(threadId: string, roleId: string, words: string) {
  const t = open(threadId);
  const role = getCrew(roleId);
  if (!role || PROTECTED_ROLES.includes(role.id)) throw new TicketError(`no role "${roleId}"`, 404);
  if (!words.trim()) throw new TicketError('quote the words the user used to confirm the role');
  const ticket = tickets.update(threadId, { role: role.id });
  return { ticket: ticketView(ticket), role: { id: role.id, name: role.name, skills: role.skills, instructions: role.charter }, stage: stageName(t.stage) };
}

export const CLOSING_CHORES = [
  'The user closed this ticket. Tidy up, then stop:',
  '1. Memory: remove this ticket from project_open_items.md. Move its project_*.md file to archive/ when nothing on it is still open, and drop its line from MEMORY.md. Keep a lesson that later tickets need in the client file or a feedback file.',
  '2. Archive this thread with ticket_archive.',
  'Post nothing to Productive or Slack.',
].join('\n');
