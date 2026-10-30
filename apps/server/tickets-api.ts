import { Hono } from 'hono';
import { z } from 'zod';
import { channels } from './db.ts';
import { createThread, postMessage } from './runner/api.ts';
import {
  DRAFT_KINDS,
  GATES,
  SOURCES,
  TicketError,
  CLOSING_CHORES,
  attachTicket,
  clientFeedback,
  closeTicket,
  createTicket,
  listTickets,
  moveTicket,
  recordGate,
  rolesForStage,
  proposeRoute,
  setRoute,
  useRole,
  saveDraft,
  ticketView,
  tickets,
} from './tickets.ts';

export const ticketsApi = new Hono();

const createSchema = z.object({
  channel: z.string().min(1),
  source: z.enum(SOURCES),
  link: z.string().nullish(),
  context: z.string().nullish(),
  title: z.string().nullish(),
  base: z.string().trim().min(1).nullish(),
  ref: z.string().trim().max(20).nullish(),
});

ticketsApi.get('/', (c) => c.json(listTickets({ channel: c.req.query('channel'), closed: c.req.query('closed') === '1' })));

ticketsApi.post('/', async (c) => {
  const body = createSchema.parse(await c.req.json());
  const channel = channels.get(body.channel);
  if (!channel || channel.kind !== 'client') throw new TicketError(`no client channel "${body.channel}"`, 404);
  const view = await createTicket(body, ({ id, prompt }) =>
    createThread({ id, channel: channel.id, role: 'ticket', prompt, title: body.title, source: 'manual', base: body.base ? { kind: 'ref', ref: body.base } : null }),
  );
  return c.json(view);
});

ticketsApi.get('/:id', (c) => {
  const t = tickets.get(c.req.param('id'));
  if (!t) throw new TicketError('no such ticket', 404);
  return c.json(ticketView(t));
});

const view = (t: ReturnType<typeof tickets.get>) => ticketView(t!);

ticketsApi.post('/:id/move', async (c) => {
  const { stage } = z.object({ stage: z.number().int() }).parse(await c.req.json());
  return c.json(view(moveTicket(c.req.param('id'), stage)));
});

ticketsApi.post('/:id/gate', async (c) => {
  const { gate, words } = z.object({ gate: z.enum(GATES), words: z.string() }).parse(await c.req.json());
  return c.json(view(recordGate(c.req.param('id'), gate, words)));
});

ticketsApi.post('/:id/draft', async (c) => {
  const { kind, text } = z.object({ kind: z.enum(DRAFT_KINDS), text: z.string() }).parse(await c.req.json());
  return c.json(view(saveDraft(c.req.param('id'), kind, text)));
});

ticketsApi.post('/:id/feedback', (c) => c.json(view(clientFeedback(c.req.param('id')))));

ticketsApi.post('/:id/close', async (c) => {
  const { by } = z.object({ by: z.enum(['user', 'agent']).default('agent') }).parse(await c.req.json().catch(() => ({})));
  const id = c.req.param('id');
  const closed = view(closeTicket(id));
  if (by === 'user') {
    await postMessage(id, CLOSING_CHORES, { mode: 'queue' });
    return c.json(closed);
  }
  return c.json({ ...closed, next: CLOSING_CHORES });
});

ticketsApi.get('/:id/roles', (c) => {
  const t = tickets.get(c.req.param('id'));
  if (!t) throw new TicketError('no such ticket', 404);
  return c.json({ stage: t.stage, roles: rolesForStage(t.stage) });
});

ticketsApi.post('/:id/role', async (c) => {
  const { role, words } = z.object({ role: z.string(), words: z.string() }).parse(await c.req.json());
  return c.json(useRole(c.req.param('id'), role, words));
});

const stagesSchema = z.array(z.number().int().min(1).max(10)).min(1).max(10);

ticketsApi.post('/:id/route-proposal', async (c) => {
  const { stages, reasons, title, branch } = z
    .object({ stages: stagesSchema, reasons: z.record(z.string(), z.string().max(300)).default({}), title: z.string().max(120).optional(), branch: z.string().optional() })
    .parse(await c.req.json());
  return c.json(view(proposeRoute(c.req.param('id'), stages, reasons, title, branch)));
});

ticketsApi.post('/:id/route', async (c) => {
  const { stages } = z.object({ stages: stagesSchema }).parse(await c.req.json());
  return c.json(view(setRoute(c.req.param('id'), stages)));
});

ticketsApi.post('/attach', async (c) => {
  const body = z
    .object({ thread_id: z.string(), source: z.enum(SOURCES).default('local'), link: z.string().nullish(), ref: z.string().max(20).nullish(), context: z.string().nullish() })
    .parse(await c.req.json());
  const { ticket, prompt } = attachTicket(body.thread_id, body);
  await postMessage(body.thread_id, prompt, { mode: 'queue' });
  return c.json(ticket);
});
