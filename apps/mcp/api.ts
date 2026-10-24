// The local Omni API as Omni's stdio MCP servers (omni.ts, ask.ts) reach it, with the URL, token and thread id
// Omni hands each thread's server (apps/server/sandbox.ts buildMcpConfig).
import { readFileSync } from 'node:fs';

const BASE = process.env.OMNI_URL ?? 'http://127.0.0.1:4747';
/** The API token: OMNI_TOKEN from the thread's env, else the file Omni named in OMNI_TOKEN_FILE (data/api-token). */
const TOKEN = process.env.OMNI_TOKEN || readToken(process.env.OMNI_TOKEN_FILE);

function readToken(file?: string) {
  try {
    return file ? readFileSync(file, 'utf8').trim() : '';
  } catch {
    return '';
  }
}

/** The thread this server was started for. */
export const SELF = process.env.OMNI_THREAD_ID ?? null;

/** A request the API answered with an error status. A 4xx means the call itself was wrong, so trying again won't help. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status);
  return body;
}

export const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });
