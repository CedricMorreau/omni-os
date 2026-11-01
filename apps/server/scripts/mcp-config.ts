// Prints how to add the external Omni MCP server (apps/mcp/external/) to each client, for this checkout and data dir.
//
//   npm run mcp:config -- [--url <https://your-mac.tailnet.ts.net>] [--show-token]
//
//   --url         the public base URL clients outside this Mac use (tailscale funnel). Default: this Mac's MagicDNS name.
//   --show-token  print the remote URLs with the MCP token in them. Without it, they show <mcp-token> and where it is.
//
// Local clients start the stdio server with this Node and read data/api-token themselves, so no token goes into their
// config. Remote clients sign in with Google through Clerk once a Google account is linked, or else get
// data/mcp-token (made here on first use), in the URL or as a Bearer header.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { tokenPath } from '../api-token.ts';
import { ROOT, config, paths } from '../config.ts';
import { owner } from '../google-auth.ts';
import { mcpToken, mcpTokenPath } from '../mcp-api.ts';
import { mcpIssuer } from '../mcp-oauth.ts';
import { tailnet } from '../tailscale.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const stdio = join(ROOT, 'apps/mcp/external/stdio.ts');
const node = process.execPath;
const desktopConfig =
  process.platform === 'darwin'
    ? join(homedir(), 'Library/Application Support/Claude/claude_desktop_config.json')
    : process.platform === 'win32'
      ? join(process.env.APPDATA ?? homedir(), 'Claude/claude_desktop_config.json')
      : join(homedir(), '.config/Claude/claude_desktop_config.json');
// A server on another port or data dir than the checkout's default: the stdio server has to be told.
const moved = {
  ...(config.port !== 4747 && { OMNI_URL: `http://127.0.0.1:${config.port}` }),
  ...(paths.data !== join(ROOT, 'data') && { OMNI_TOKEN_FILE: tokenPath() }),
};
const env = Object.keys(moved).length ? moved : undefined;
const dnsName = (await tailnet())?.self.dnsName;
const base = (flag('--url') ?? (dnsName ? `https://${dnsName}` : 'https://<your-mac>.<tailnet>.ts.net')).replace(/\/+$/, '');
const token = mcpToken();
const oauth = mcpIssuer();
const shown = args.includes('--show-token') ? token : '<mcp-token>';
const envFlags = env ? Object.entries(env).map(([k, v]) => ` -e ${k}=${v}`).join('') : '';

const out = `
Omni MCP server

ON THIS MACHINE (stdio)

Merge the "omni" entry into the mcpServers of Claude Desktop (${desktopConfig}), Cursor (${join(homedir(), '.cursor/mcp.json')})
or any client with an mcpServers file:

${JSON.stringify({ mcpServers: { omni: { command: node, args: [stdio], ...(env && { env }) } } }, null, 2)}

Claude Code:  claude mcp add --scope user omni${envFlags} -- ${node} ${stdio}
Codex:        codex mcp add omni${env ? envFlags.replace(/ -e /g, ' --env ') : ''} -- ${node} ${stdio}

FROM ANYWHERE ELSE (Streamable HTTP)

Expose /mcp and its sign-in metadata to the internet (claude.ai and ChatGPT call from their own servers):

  tailscale funnel --bg --set-path /mcp http://127.0.0.1:${config.port}/mcp
  tailscale funnel --bg --set-path /.well-known http://127.0.0.1:${config.port}/.well-known

${
  oauth
    ? `Google sign-in is on (${oauth}), for ${owner()?.email ?? owner()?.sub}. Add this URL and sign in with that account:

  ${base}/mcp

  claude.ai: Settings > Connectors > Add custom connector, then Connect
  ChatGPT:   Settings > Apps > Developer mode > Create, with OAuth
  Claude Code, Cursor or Codex elsewhere: add it as an HTTP server`
    : `Google sign-in is off: link a Google account in Settings > Machines to let claude.ai and ChatGPT sign in
with it. Until then they use the MCP token in the URL.`
}

A client without OAuth: the MCP token in the URL, where only a URL fits (claude.ai or ChatGPT without OAuth):

  ${base}/mcp/${shown}

or as a header (Grok, the xAI API, any client that sends headers):

  URL     ${base}/mcp
  Header  Authorization: Bearer ${shown}
${shown === token ? '' : `\nThe MCP token is in ${mcpTokenPath()}. Pass --show-token to print it. Delete the file and restart Omni to rotate it.\n`}`;

console.log(out);
