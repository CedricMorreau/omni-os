// The external Omni MCP server over Streamable HTTP, stateless: each POST gets a fresh server and transport and a
// JSON answer, so nothing is kept between requests and a server restart drops no session. Omni serves it at /mcp
// (apps/server/mcp-api.ts), which checks the token before a request reaches it.
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createExternalServer, type Call } from './tools.ts';

const notAllowed = () =>
  new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed: this server is stateless, POST only.' }, id: null }), {
    status: 405,
    headers: { 'content-type': 'application/json', allow: 'POST' },
  });

/** Answers one MCP request over `call`. */
export function mcpHttp(call: Call) {
  return async (req: Request): Promise<Response> => {
    // No session, so no stream to GET and nothing to DELETE.
    if (req.method !== 'POST') return notAllowed();
    const server = createExternalServer(call);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req);
    } finally {
      // The JSON answer is complete by now, so closing frees the server without cutting it off.
      void server.close();
    }
  };
}
