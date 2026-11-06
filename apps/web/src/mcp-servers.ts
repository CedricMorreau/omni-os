export type McpServer = { name: string; status: string; scope?: string };
export type McpAction = 'reconnect' | 'authenticate' | 'clear_auth' | 'enable' | 'disable';

export const MCP_ACTION_LABEL: Record<McpAction, string> = {
  reconnect: 'Reconnect',
  authenticate: 'Authenticate',
  clear_auth: 'Clear authentication',
  enable: 'Enable',
  disable: 'Disable',
};

export const mcpFromInit = (servers: string[]): McpServer[] =>
  servers.map((m) => {
    const cut = m.lastIndexOf(':');
    return cut > 0 ? { name: m.slice(0, cut), status: m.slice(cut + 1) } : { name: m, status: 'connected' };
  });

export function mcpActions(s: McpServer): McpAction[] {
  if (s.status === 'disabled') return ['enable'];
  if (s.status === 'needs-auth') return ['authenticate', 'disable'];
  if (s.status === 'connected' && s.scope === 'claudeai') return ['reconnect', 'authenticate', 'clear_auth', 'disable'];
  return ['reconnect', 'disable'];
}

export function mcpStatusText(s: McpServer) {
  if (s.status === 'connected') return 'Connected.';
  if (s.status === 'needs-auth')
    return s.scope === 'claudeai'
      ? 'Not signed in on claude.ai. Choose Authenticate and sign in in the browser, then choose Reconnect.'
      : 'Needs a sign-in. Choose Authenticate and sign in in the browser, then choose Reconnect.';
  if (s.status === 'failed') return 'Failed to start.';
  if (s.status === 'disabled') return 'Switched off.';
  if (s.status === 'pending') return 'Still connecting.';
  return s.status;
}
