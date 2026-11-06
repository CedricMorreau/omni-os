// Stdio MCP server every local thread without the conductor's `omni` server gets (apps/server/sandbox.ts): only
// read_referenced_thread, so an agent can read a thread Ben referenced, and draft_message for the draft panel.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { call, SELF, text } from './api.ts';
import { registerReferencedThread } from './referenced-thread.ts';

const server = new McpServer({ name: 'omni-threads', version: '0.1.0' });
registerReferencedThread(server);

server.registerTool(
  'draft_message',
  {
    description:
      `Put a message for a client or a third party in this thread's draft panel, for ${process.env.OMNI_USER || 'the user'} to rewrite and post. ` +
      'A new draft replaces the old one. You never post it yourself.',
    inputSchema: { text: z.string().min(1) },
  },
  async ({ text: body }) => text(await call(`/threads/${SELF}/draft`, { method: 'POST', body: JSON.stringify({ text: body }) })),
);

// The harness closed our stdin: it is gone.
process.stdin.on('end', () => process.exit(0));

await server.connect(new StdioServerTransport());
