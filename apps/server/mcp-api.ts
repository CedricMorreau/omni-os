// /mcp: the external Omni MCP server (apps/mcp/external/) over Streamable HTTP, for clients that reach Omni by URL
// rather than starting a process here: claude.ai, ChatGPT, Grok, or Cursor and Claude Code on another machine.
//
// It takes its own token, data/mcp-token, apart from the API token: the URL goes into other companies' connector
// settings, and rotating it (delete the file, restart) must not unpair every browser. A client that can send a header
// sends `Authorization: Bearer <mcp-token>`; one that only takes a URL (claude.ai and ChatGPT without OAuth) uses
// /mcp/<mcp-token>. The API token also works as a header, never in the path. Its tools then call /api in-process
// with the API token, so every request still passes requestGuard.
//
// No Tailscale login check: Funnel, the way claude.ai and ChatGPT reach a Mac, carries none. The token is the control.
import { join } from 'node:path';
import { Hono } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';
import { callOver } from '@omni/mcp/external/tools.ts';
import { mcpHttp } from '@omni/mcp/external/http.ts';
import { apiToken, loadToken, tokenMatches } from './api-token.ts';
import { paths } from './config.ts';
import { hostAllowed } from './request-guard.ts';

export const mcpTokenPath = () => join(paths.data, 'mcp-token');

let cached: string | null = null;

/** The connector token, made on first use. OMNI_MCP_TOKEN wins, for tests and throwaway servers. */
export function mcpToken(): string {
  cached ??= loadToken(mcpTokenPath(), { OMNI_TOKEN: process.env.OMNI_MCP_TOKEN });
  return cached;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
const mcpTokenMatches = (given: string | undefined) => !!given && timingSafeEqual(digest(given), digest(mcpToken()));

const hostnameOf = (host: string) => {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return '';
  }
};

const refuse = (message: string, status: 401 | 403) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status,
    headers: { 'content-type': 'application/json', ...(status === 401 && { 'www-authenticate': 'Bearer' }) },
  });

/** The router for /mcp, whose tools reach /api through `request` (app.request, in-process). */
export function mcpApi(request: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const call = callOver(async (path, init) =>
    request(path, { ...init, headers: { ...init.headers, host: '127.0.0.1', authorization: `Bearer ${apiToken()}` } }),
  );
  const answer = mcpHttp(call);
  const router = new Hono();

  router.all('/:token?', async (c) => {
    // DNS rebinding: a page on an attacker's name pointed at this Mac. Funnel and tailscale serve keep the .ts.net name.
    if (!hostAllowed(hostnameOf(c.req.header('host') ?? new URL(c.req.url).host))) return refuse('Forbidden: host not allowed', 403);
    // claude.ai and ChatGPT call from their servers with no Origin. A browser page on another site would send one.
    const origin = c.req.header('origin');
    if (origin !== undefined && !hostAllowed(hostnameOf(origin.replace(/^[a-z]+:\/\//i, '')))) return refuse('Forbidden: origin not allowed', 403);
    const inPath = c.req.param('token');
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
    const ok = inPath !== undefined ? mcpTokenMatches(inPath) : mcpTokenMatches(bearer) || tokenMatches(bearer);
    if (!ok) return refuse("Unauthorized: send this install's MCP token (data/mcp-token) as a Bearer header or in the URL as /mcp/<token>", 401);
    return answer(c.req.raw);
  });

  return router;
}
