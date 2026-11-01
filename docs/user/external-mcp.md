# Omni as an MCP server for other apps

Agents outside Omni can use it through MCP: Claude Desktop, claude.ai, ChatGPT, Cursor, Codex, Claude Code, Grok or anything else that speaks MCP. They can see your channels and threads, read what a thread said, start new threads (the Conductor too) and steer or stop them.

| Tool | What it does |
| --- | --- |
| `list_channels`, `list_crew`, `list_harnesses` | What exists, and the valid ids for `start_thread` |
| `list_threads`, `search_threads` | Recent threads by channel or status, and full-text search |
| `get_thread` | Status and last reply. `wait_seconds` (up to 50) waits for a running thread to finish |
| `read_thread` | The conversation a page at a time, without tool calls |
| `start_thread` | A new thread in a channel, as any crew role. It runs in the background |
| `message_thread`, `stop_thread`, `mark_thread_done` | Steer, queue or interrupt a thread, stop its turn, clear it from Needs you |

A thread started here has no parent, so its reply does not come back as a `[crew report]`: the calling agent gets it with `get_thread`. The code is in `apps/mcp/external/`, and the same tools serve both ways in below.

## Set it up

```bash
npm run mcp:config
```

prints the config for each client below, filled in for this checkout, port and data dir.

### On the machine Omni runs on (stdio)

Claude Desktop, Cursor, Claude Code and Codex start `apps/mcp/external/stdio.ts` with Node. It reads `data/api-token` itself, so no token goes into their config files. Paste the `mcpServers` block into `claude_desktop_config.json` or `~/.cursor/mcp.json`, or run the `claude mcp add` or `codex mcp add` line. Restart the client.

The server has to be running (`npm start`, `npm run dev` or the Mac app). The stdio server only relays to it.

### From anywhere else (HTTP)

Omni serves the same tools at `/mcp` over Streamable HTTP. claude.ai and ChatGPT call it from their own servers, so your tailnet alone is not enough. Expose only `/mcp` to the internet with Tailscale Funnel:

```bash
tailscale funnel --bg --set-path /mcp http://127.0.0.1:4747/mcp
```

Then add the URL `npm run mcp:config -- --show-token` prints:

- **claude.ai** (also reaches Claude Desktop and the Claude phone app): Settings, Connectors, Add custom connector, with `https://<your-mac>.<tailnet>.ts.net/mcp/<mcp-token>`.
- **ChatGPT**: turn on developer mode, then create a connector (app) with the same URL and no authentication.
- **Grok, the xAI API, or Cursor and Claude Code on another machine**: `https://<your-mac>.<tailnet>.ts.net/mcp` with the header `Authorization: Bearer <mcp-token>`.

The Mac has to be awake for any of these to answer.

## Security

`/mcp` takes its own token, `data/mcp-token` (mode 0600, made on first use), apart from the API token. claude.ai and ChatGPT without OAuth only take a URL, so the token goes in the path. The API token is accepted only as a header, never in a URL.

Anyone with the URL can start threads on your Mac, and threads run with `bypassPermissions`. Treat the URL like a password. To rotate it, delete `data/mcp-token`, restart Omni and update each client.

Through Funnel, the `integrations.tailscaleLogin` check that guards `/api` does not apply, since Funnel requests carry no Tailscale login. The token is the only control on `/mcp`. Everything else stays off the internet: `--set-path /mcp` forwards that path only, and the tools reach `/api` in-process through the usual request guard. `/mcp` also refuses a `Host` outside the allowed names and a browser `Origin` from another site, the same DNS-rebinding checks as `/api` (see [Remote access and security](remote-access.md)).

The server is stateless: each request gets a fresh MCP server, so a restart drops no session. There is no OAuth, so clients that insist on it cannot connect.
