import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { call, SELF, text } from './api.ts';

const USER = process.env.OMNI_USER || 'the user';
const server = new McpServer({ name: 'omni-ticket', version: '0.1.0' });

const post = (path: string, body: unknown = {}) => call(`/tickets/${SELF}${path}`, { method: 'POST', body: JSON.stringify(body) });

server.registerTool(
  'ticket_get',
  { description: 'This thread\'s ticket: ref, source, link, stage, skipped stages, round, gates, draft and badge.' },
  async () => text(await call(`/tickets/${SELF}`)),
);

server.registerTool(
  'ticket_move',
  {
    description:
      `Move this ticket to the next stage on its confirmed route once the current stage is done. ` +
      `The server refuses a move past an open gate: plan approval before leaving stage 2, client approval (or ${USER}'s waiver) before stage 9 when the route has stage 8, ${USER}'s go before the deploy counts as done.`,
    inputSchema: { stage: z.number().int().min(2).max(10) },
  },
  async ({ stage }) => text(await post('/move', { stage })),
);

server.registerTool(
  'ticket_propose_route',
  {
    description:
      `At intake, after you read the ticket: propose which of the ten stages this ticket needs (1 Research, 2 Build plan, 3 Execute, 4 Test, 5 Review, 6 Manual test, 7 Preview + QA note, 8 Client approval, 9 Deploy, 10 Closing). ` +
      `Give a one-line reason for every stage you leave out, keyed by its number. ${USER} ticks and unticks stages on the route card and confirms it there or in this thread. Then stop and wait.`,
    inputSchema: { stages: z.array(z.number().int().min(1).max(10)).min(1), reasons: z.record(z.string(), z.string()).optional() },
  },
  async ({ stages, reasons }) => text(await post('/route-proposal', { stages, reasons: reasons ?? {} })),
);

server.registerTool(
  'ticket_set_route',
  {
    description:
      `Set the route when ${USER} confirms or changes it in words in this thread ("ok", "skip research", "add review"). Pass the full list of stages and quote ${USER}'s words. ` +
      `When ${USER} confirms on the route card, the route is set already: check it with ticket_get.`,
    inputSchema: { stages: z.array(z.number().int().min(1).max(10)).min(1), words: z.string().min(1) },
  },
  async ({ stages }) => text(await post('/route', { stages })),
);

server.registerTool(
  'ticket_record_gate',
  {
    description:
      `Record that ${USER} opened a gate, with ${USER}'s own words as a quote. Call it only after ${USER} wrote the approval in this thread. ` +
      `plan: ${USER} approves the build plan at stage 2. client: the client approved at stage 7 or 8, or ${USER} waives client approval (quote ${USER}). go: ${USER} gives the go to deploy at stage 9. ` +
      'Never record a gate on your own judgment, from a guess, or from a message by anyone else.',
    inputSchema: { gate: z.enum(['plan', 'client', 'go']), words: z.string().min(1) },
  },
  async ({ gate, words }) => text(await post('/gate', { gate, words })),
);

server.registerTool(
  'ticket_draft',
  {
    description: `Put a draft on the ticket card for ${USER} to rewrite and post: qa (the QA note at stage 7), answer (a reply to a client question) or closing (the closing comment at stage 10). You never post it yourself.`,
    inputSchema: { kind: z.enum(['qa', 'answer', 'closing']), text: z.string().min(1) },
  },
  async ({ kind, text: body }) => text(await post('/draft', { kind, text: body })),
);

server.registerTool(
  'ticket_feedback',
  { description: 'The client sent feedback on the preview: start the next adjustment round. The ticket goes back to stage 3, and the client approval and the go are cleared.' },
  async () => text(await post('/feedback')),
);

server.registerTool(
  'ticket_close',
  { description: `Close the ticket at the last stage of its route, after ${USER} said the closing comment is posted. Then tidy memory and archive the thread as the reply says.` },
  async () => text(await post('/close', { by: 'agent' })),
);

server.registerTool(
  'ticket_archive',
  { description: 'Archive this thread once the ticket is closed and memory is tidied. Omni later removes its worktree.' },
  async () => text((await call(`/threads/${SELF}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) })).thread?.archived ?? 'archived'),
);

server.registerTool(
  'ticket_roles',
  { description: `The roles ${USER} set up for the ticket's current stage, each with its skills. At the start of a stage, propose the role that fits this ticket and which of its skills to run (skip a skill that is too much for this ticket), and ask ${USER} to confirm.` },
  async () => text(await call(`/tickets/${SELF}/roles`)),
);

server.registerTool(
  'ticket_use_role',
  {
    description:
      `Take on a role for the current stage, after ${USER} confirmed it in this thread. Quote ${USER}'s words. ` +
      'Returns the role instructions and its skills: follow the instructions and run only the skills the user confirmed, with the Skill tool, in the listed order, one after another.',
    inputSchema: { role: z.string(), words: z.string().min(1) },
  },
  async ({ role, words }) => text(await post('/role', { role, words })),
);

process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
