// A sign-in poll that fails on the way, not at the server, is worth another try. tailscale serve and cloudflared
// answer an empty 502 when the connection to the server drops mid-request (apps/server/keep-alive.ts), and status 0
// is the browser's own network error. A poll is safe to repeat: the server keeps a flow's outcome for every poll.

/** Gateway failures and network errors in a row before the sign-in gives up. */
export const POLL_RETRIES = 3;

/** True for a status that says the request never got a real answer: no response, or a proxy's 502, 503 or 504. */
export const isTransientStatus = (status: number) => status === 0 || status === 502 || status === 503 || status === 504;
