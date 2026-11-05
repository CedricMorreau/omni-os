import { Hono } from 'hono';
import { updater } from './update.ts';

// The Update button (update.ts): how far this server is behind main, and the one click that brings it level.
export const updateApi = new Hono();

updateApi.get('/', (c) => c.json(updater.view()));

/** Fetches origin's main now, instead of waiting for the next check. */
updateApi.post('/check', async (c) => c.json(await updater.check()));

/** Waits for running turns, updates to main, rebuilds the Web UI and restarts. 409 without an app to restart it. */
updateApi.post('/', (c) => {
  const started = updater.apply();
  if (!started.ok) return c.json({ error: started.error }, 409);
  return c.json(updater.view(), 202);
});

/** Ends the wait for running turns. */
updateApi.post('/cancel', (c) => c.json({ ok: updater.cancel() }));

updateApi.post('/dismiss', (c) => {
  updater.dismiss();
  return c.json(updater.view());
});
