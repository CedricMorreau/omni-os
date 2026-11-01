// The external Omni MCP server over stdio, for a client that starts it on the machine Omni runs on (Claude Desktop,
// Claude Code, Cursor, Codex): `node apps/mcp/external/stdio.ts`. `npm run mcp:config` prints the entry for each.
// It reaches Omni at OMNI_URL (default http://127.0.0.1:4747) with OMNI_TOKEN, else the token file OMNI_TOKEN_FILE
// names, else data/api-token of OMNI_DATA_DIR or of this checkout. No token goes into the client's config file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { callOver, createExternalServer } from './tools.ts';

const BASE = (process.env.OMNI_URL || 'http://127.0.0.1:4747').replace(/\/+$/, '');
const DATA = process.env.OMNI_DATA_DIR || join(import.meta.dirname, '../../../data');
const TOKEN_FILE = process.env.OMNI_TOKEN_FILE || join(DATA, 'api-token');

function token(): string {
  if (process.env.OMNI_TOKEN) return process.env.OMNI_TOKEN.trim();
  try {
    return readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    // Every call then answers 401, which names the token: the client shows that, not a server that would not start.
    return '';
  }
}

const TOKEN = token();
const call = callOver((path, init) => fetch(`${BASE}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}` } }));

// The client closed our stdin: it is gone.
process.stdin.on('end', () => process.exit(0));

await createExternalServer(call).connect(new StdioServerTransport());
