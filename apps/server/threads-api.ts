// PATCH /api/threads/:id: Ben's edits to a thread. Its own app so tests can call it without starting the server.
import { Hono } from 'hono';
import { z } from 'zod';
import { TITLE_MAX } from '@omni/shared/slash.ts';
import { publishFeed } from './bus.ts';
import { FolderError, folders, threads, type Thread } from './db.ts';
import { controlThread, isLive } from './runner/state.ts';

export const threadsApi = new Hono();

const titleSchema = z
  .string({ error: 'a title is required' })
  .transform((s) => s.replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'a title is required').max(TITLE_MAX, `a title can be up to ${TITLE_MAX} characters`));

const patchSchema = z
  .object({
    // One line, since `/rename` sends whatever followed the command.
    title: titleSchema.optional(),
    archived: z.union([z.boolean(), z.literal(0), z.literal(1)]).optional(),
    /** The sidebar folder to put it in, from its own channel. Null takes it out, back to the ungrouped list. */
    folder_id: z.string().nullable().optional(),
    /** Pin it to the sidebar's Pinned section, or unpin it. */
    pinned: z.boolean().optional(),
    /** Mark it done, out of Needs you until something new happens in it, or not done again. */
    done: z.boolean().optional(),
    /** Null dismisses the proposed follow-up thread, the card under the transcript. */
    next_thread: z.null().optional(),
  })
  .refine((b) => b.title !== undefined || b.archived !== undefined || b.folder_id !== undefined || b.pinned !== undefined || b.done !== undefined || b.next_thread !== undefined, 'a title is required');

/** Rename, archive, pin, mark done or file a thread, or dismiss its proposed follow-up. It keeps its place in the lists, since nothing happened in it. */
threadsApi.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const t = threads.get(id);
  if (!t) return c.json({ error: 'not found' }, 404);
  const body = patchSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? 'a title is required' }, 400);
  // An archived thread is out of the lists, so it has no place in Pinned either.
  if (body.data.pinned && (body.data.archived ?? !!t.archived)) return c.json({ error: 'an archived thread cannot be pinned' }, 409);
  // A turn still going brings its own result, so there is nothing to be done with yet.
  if (body.data.done && (t.status === 'running' || t.status === 'queued')) return c.json({ error: 'a running thread cannot be marked done' }, 409);
  const edit: Partial<Thread> = {};
  if (body.data.title !== undefined) edit.title = body.data.title;
  if (body.data.archived !== undefined) edit.archived = body.data.archived ? 1 : 0;
  if (body.data.folder_id !== undefined) {
    try {
      folders.moveThread(id, body.data.folder_id);
    } catch (err) {
      if (err instanceof FolderError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  }
  if (body.data.next_thread === null) threads.setNextThread(id, null);
  // Archiving unpins: restoring it later brings it back to its channel, not to Pinned.
  if (body.data.pinned !== undefined || edit.archived) threads.setPinned(id, !!body.data.pinned && !edit.archived);
  if (body.data.done !== undefined) threads.setDone(id, body.data.done);
  // Archived: a usage limit's continuation no longer runs by itself (apps/server/runner/limits.ts).
  if (edit.archived) threads.setLimit(id, null);
  const renamed = Object.keys(edit).length ? threads.update(id, { ...edit, updated_at: t.updated_at })! : threads.get(id)!;
  publishFeed({ type: 'thread', thread: renamed });
  if (body.data.done !== undefined) publishFeed({ type: 'needs_you', thread_id: id });
  return c.json(renamed);
});

const MCP_ACTIONS = {
  reconnect: { subtype: 'mcp_reconnect' },
  authenticate: { subtype: 'mcp_authenticate' },
  clear_auth: { subtype: 'mcp_clear_auth' },
  enable: { subtype: 'mcp_toggle', enabled: true },
  disable: { subtype: 'mcp_toggle', enabled: false },
} as const;

const mcpSchema = z.union([
  z.object({ action: z.literal('status') }),
  z.object({ action: z.enum(Object.keys(MCP_ACTIONS) as [keyof typeof MCP_ACTIONS]), server: z.string().min(1) }),
]);

type McpRow = { name: string; status: string; scope?: string };

/** The live MCP servers of a thread's Claude Code process, and the /mcp actions on one of them. */
threadsApi.post('/:id/mcp', async (c) => {
  const id = c.req.param('id');
  if (!threads.get(id)) return c.json({ error: 'not found' }, 404);
  const body = mcpSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: 'unknown MCP action' }, 400);
  if (!isLive(id)) return c.json({ error: 'The thread has no running process. Send a message to start it.' }, 409);
  const ask = (request: { subtype: string } & Record<string, unknown>) => controlThread(id, request);
  let authUrl: string | null = null;
  if (body.data.action !== 'status') {
    const reply = await ask({ ...MCP_ACTIONS[body.data.action], serverName: body.data.server });
    if (!reply) return c.json({ error: 'Only a Claude Code thread can change its MCP servers.' }, 409);
    if (!reply.ok) return c.json({ error: reply.error }, 502);
    authUrl = (reply.response as { authUrl?: string } | null)?.authUrl ?? null;
  }
  const status = await ask({ subtype: 'mcp_status' });
  if (!status) return c.json({ error: 'Only a Claude Code thread can change its MCP servers.' }, 409);
  if (!status.ok) return c.json({ error: status.error }, 502);
  const rows = ((status.response as { mcpServers?: McpRow[] } | null)?.mcpServers ?? []).map(({ name, status: s, scope }) => ({ name, status: s, scope }));
  return c.json({ servers: rows, auth_url: authUrl });
});
