// /api/crew, /harnesses, /secrets, /automations, /profile, /devices.
import { Hono } from 'hono';
import { z } from 'zod';
import { lastRuns, loadAutomations, runAutomation, setEnabled } from './automations.ts';
import { pollErrors, watchedRepo } from './automation-watch.ts';
import { isPrTrigger } from './automation-events.ts';
import { recentDeliveries } from './automation-deliveries.ts';
import { webhookInfo } from './github-webhook-api.ts';
import { PROTECTED_ROLES, ROLE_ID, deleteRole, getCrew, listCrew, saveRole } from './crew.ts';
import { channelCatalog, freshCatalog, getCatalog } from './harness/catalog-service.ts';
import { validateDefaults } from './harness/resolve.ts';
import { HARNESS_INSTALL } from './harness/types.ts';
import { runningByHarness } from './runner.ts';
import { getProfile, profileInput, setProfile } from './profile.ts';
import { deleteSecret, listSecrets, setSecret } from './secrets.ts';
import { listDevices } from './sync/devices.ts';

export const metaApi = new Hono();

metaApi.get('/crew', (c) => {
  const cat = getCatalog();
  return c.json(
    listCrew().map((r) => ({
      ...r,
      error: r.error ?? validateDefaults({ harness: r.harness, model: r.model, effort: r.effort }, cat),
    })),
  );
});

const roleInput = z.object({
  name: z.string().trim().min(1, 'Give the role a name.').max(40),
  description: z.string().trim().max(200).default(''),
  model: z.string().trim().optional(),
  skills: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  stages: z.array(z.number().int().min(1).max(10)).max(10).default([]),
  charter: z.string().max(20_000).default(''),
});

const roleError = (message: string, status: 400 | 404 | 409) => Object.assign(new Error(message), { status });

metaApi.post('/crew', async (c) => {
  const body = roleInput.extend({ id: z.string().regex(ROLE_ID, 'Use lowercase letters, digits and dashes for the id.') }).parse(await c.req.json());
  if (getCrew(body.id)) throw roleError(`A role with the id "${body.id}" already exists.`, 409);
  return c.json(saveRole(body.id, body), 201);
});

metaApi.put('/crew/:id', async (c) => {
  const current = getCrew(c.req.param('id'));
  if (!current) throw roleError('No such role.', 404);
  return c.json(saveRole(current.id, roleInput.parse(await c.req.json()), current));
});

metaApi.delete('/crew/:id', (c) => {
  const id = c.req.param('id');
  if (PROTECTED_ROLES.includes(id)) throw roleError(`The ${id} role cannot be deleted.`, 409);
  if (!deleteRole(id)) throw roleError(getCrew(id) ? 'A shipped role cannot be deleted. Remove its stages instead.' : 'No such role.', getCrew(id) ? 409 : 404);
  return c.json({ ok: true });
});

// The harnesses with their availability, fix command, models, efforts, cap and running count.
// A harness that is down is probed again first, so a login shows up when the picker opens.
// With ?channel=, as that channel sees them: Cursor Cloud needs its GitHub repo and can use its own key.
metaApi.get('/harnesses', async (c) => {
  const cat = channelCatalog(await freshCatalog(), c.req.query('channel'));
  const running = runningByHarness();
  return c.json(cat.harnesses.map((h) => ({ ...h, running: running[h.id] ?? 0, ...(!h.available && HARNESS_INSTALL[h.id] && { install: HARNESS_INSTALL[h.id] }) })));
});

/** The other synced Macs a thread can be handed to, with whether Tailscale sees each up. Empty while sync is off. */
metaApi.get('/devices', async (c) => c.json(await listDevices()));

metaApi.get('/secrets', (c) => c.json(listSecrets()));
metaApi.post('/secrets', async (c) => {
  const { scope, name, value } = z.object({ scope: z.string(), name: z.string(), value: z.string() }).parse(await c.req.json());
  await setSecret(scope, name, value);
  return c.json({ ok: true });
});
metaApi.delete('/secrets', async (c) => {
  const { scope, name } = z.object({ scope: z.string(), name: z.string() }).parse(await c.req.json());
  await deleteSecret(scope, name);
  return c.json({ ok: true });
});

// Who uses this Omni. The name is in GET /api/status too, so a client learns it with the rest of the workspace.
metaApi.get('/profile', (c) => c.json(getProfile()));
metaApi.put('/profile', async (c) => {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ error: 'send JSON' }, 415);
  // The first issue's text, so a client can show "Enter a name." as it is.
  const parsed = profileInput.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile' }, 400);
  return c.json(setProfile(parsed.data));
});

metaApi.get('/automations', (c) => {
  const cat = getCatalog();
  return c.json(
    loadAutomations().map((a) => ({
      ...a,
      error: a.error ?? validateDefaults({ harness: a.harness, model: a.model, effort: a.effort }, cat),
      // PR event automations: the repo they watch and why the last poll failed, if it did.
      ...(isPrTrigger(a.on) && { repo: watchedRepo({ ...a, on: a.on }), poll_error: pollErrors.get(a.id) ?? null }),
      // Webhook automations: where GitHub posts, and whether this Mac holds the signing secret (never its value).
      ...webhookInfo(a),
      runs: lastRuns(a.id, 5),
      // What events reached it and what became of each, newest first, and whether the history has older ones.
      ...recentDeliveries(a.id),
    })),
  );
});
metaApi.post('/automations/:id/run', async (c) => {
  const a = loadAutomations().find((x) => x.id === c.req.param('id'));
  if (!a) return c.json({ error: 'not found' }, 404);
  if (a.error) return c.json({ error: a.error }, 400);
  return c.json(await runAutomation(a, 'manual'));
});
metaApi.post('/automations/:id/enabled', async (c) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(await c.req.json());
  setEnabled(c.req.param('id'), enabled);
  return c.json({ ok: true });
});
