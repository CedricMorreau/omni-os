import { describe, expect, it } from 'vitest';
import { mcpActions, mcpFromInit, mcpStatusText } from '../src/mcp-servers.ts';

describe('MCP server chips', () => {
  it('reads the init snapshot', () => {
    expect(mcpFromInit(['omni-ask:connected', 'claude.ai Acme:needs-auth', 'plain'])).toEqual([
      { name: 'omni-ask', status: 'connected' },
      { name: 'claude.ai Acme', status: 'needs-auth' },
      { name: 'plain', status: 'connected' },
    ]);
  });

  it('offers the actions that fit the status', () => {
    expect(mcpActions({ name: 'claude.ai Acme', status: 'needs-auth', scope: 'claudeai' })).toEqual(['authenticate', 'disable']);
    expect(mcpActions({ name: 'claude.ai Shopify', status: 'connected', scope: 'claudeai' })).toEqual(['reconnect', 'authenticate', 'clear_auth', 'disable']);
    expect(mcpActions({ name: 'productive', status: 'connected', scope: 'user' })).toEqual(['reconnect', 'disable']);
    expect(mcpActions({ name: 'notion', status: 'failed' })).toEqual(['reconnect', 'disable']);
    expect(mcpActions({ name: 'notion', status: 'disabled' })).toEqual(['enable']);
  });

  it('says the status in words', () => {
    expect(mcpStatusText({ name: 'claude.ai Acme', status: 'needs-auth', scope: 'claudeai' })).toBe('Not signed in on claude.ai. Choose Authenticate and sign in in the browser, then choose Reconnect.');
    expect(mcpStatusText({ name: 'notion', status: 'failed' })).toBe('Failed to start.');
    expect(mcpStatusText({ name: 'notion', status: 'connected' })).toBe('Connected.');
  });
});
