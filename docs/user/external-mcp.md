# Omni as an MCP server for other apps

Agents outside Omni can use it through MCP: Claude Desktop, claude.ai, ChatGPT, Cursor, Codex, Claude Code, Grok or anything else that speaks MCP. They can see your channels and threads, read what a thread said, start new threads (the Conductor too), steer or stop them, organize them into folders and run automations.

| Tool | What it does |
| --- | --- |
| `list_channels`, `list_crew`, `list_harnesses` | What exists, and the valid ids for `start_thread` |
| `list_threads`, `search_threads` | Recent threads by channel or status, and full-text search |
| `get_thread` | Status and last reply. `wait_seconds` (up to 50) waits for a running thread to finish |
| `read_thread` | The conversation a page at a time, without tool calls |
| `start_thread` | A new thread in a channel, as any crew role. It runs in the background |
| `message_thread`, `stop_thread` | Steer, queue or interrupt a thread, or stop its turn |
| `update_thread` | Rename, file in a folder, pin, archive or mark done |
| `switch_thread_run` | Move a thread to another harness, model or effort for its next message |
| `list_folders`, `create_folder`, `rename_folder`, `delete_folder` | A channel's sidebar folders. Deleting one keeps its threads |
| `list_automations`, `run_automation`, `set_automation_enabled` | See automations and their last runs, run one now, turn one on or off |

A thread started here has no parent, so its reply does not come back as a `[crew report]`: the calling agent gets it with `get_thread`. The code is in `apps/mcp/external/`, and the same tools serve both ways in below.

## Let an agent install it

Paste this into Claude Code, Codex, Cursor or any agent with a shell on the machine Omni runs on. Swap `~/omni-os` if your checkout is elsewhere.

```text
Install the Omni MCP server for me. Omni is checked out at ~/omni-os and its server runs on this machine.
1. Run `cd ~/omni-os && npm run -s mcp:config` and read what it prints. Never print or paste the contents
   of data/api-token or data/mcp-token, and don't pass --show-token.
2. Add the "omni" server to every MCP client installed here, using the stdio entry it printed:
   Claude Code: run the `claude mcp add` line. Codex: run the `codex mcp add` line.
   Claude Desktop and Cursor: merge the "omni" entry into the "mcpServers" of the config file it names,
   keeping every other server. Create the file if it is missing.
   Skip a client that is not installed, and if "omni" is already there, replace only that entry.
3. Check it: if the omni tools are loaded in this session, call list_channels. Otherwise run
   `claude mcp list` or `codex mcp list` and confirm omni shows as connected.
4. Tell me which clients you set up, which ones need a restart, and the exact steps for the ones you
   cannot set up from here: claude.ai and ChatGPT need the `tailscale funnel` lines from step 1 run
   first, then the remote URL, and I sign in with Google there myself.
```

## Set it up by hand

```bash
npm run mcp:config
```

prints the config for each client below, filled in for this checkout, port and data dir.

### On the machine Omni runs on (stdio)

Claude Desktop, Cursor, Claude Code and Codex start `apps/mcp/external/stdio.ts` with Node. It reads `data/api-token` itself, so no token goes into their config files. Paste the `mcpServers` block into `claude_desktop_config.json` or `~/.cursor/mcp.json`, or run the `claude mcp add` or `codex mcp add` line. Restart the client.

The server has to be running (`npm start`, `npm run dev` or the Mac app). The stdio server only relays to it.

### From anywhere else (HTTP)

Omni serves the same tools at `/mcp` over Streamable HTTP. claude.ai and ChatGPT call it from their own servers, so your tailnet alone is not enough. Expose `/mcp` and the sign-in metadata, and nothing else, with Tailscale Funnel:

```bash
tailscale funnel --bg --set-path /mcp http://127.0.0.1:4747/mcp
tailscale funnel --bg --set-path /.well-known http://127.0.0.1:4747/.well-known
```

With a Google account linked (Settings, Machines, Google account; see [Sign in with Google](remote-access.md#sign-in-with-google)), clients sign in with Google through Clerk and hold no Omni token:

- **claude.ai** (also reaches Claude Desktop and the Claude phone app): Settings, Connectors, Add custom connector, with `https://<your-mac>.<tailnet>.ts.net/mcp`. Choose Connect and sign in with the linked Google account.
- **ChatGPT**: turn on developer mode, then create a connector (app) with the same URL and OAuth authentication.
- **Claude Code, Cursor or Codex on another machine**: add `https://<your-mac>.<tailnet>.ts.net/mcp` as an HTTP server. They sign in the same way on first use.

A client that cannot do OAuth uses the MCP token that `npm run mcp:config -- --show-token` prints instead: `https://<your-mac>.<tailnet>.ts.net/mcp/<mcp-token>` where only a URL fits, or `/mcp` with the header `Authorization: Bearer <mcp-token>` (Grok and the xAI API).

The Mac has to be awake for any of these to answer.

#### What the Clerk instance needs

Google sign-in for devices already needs a public OAuth application with the device grant. For MCP clients, also turn on **dynamic client registration** in the Clerk dashboard (OAuth applications settings): claude.ai, ChatGPT and the other clients register themselves there, as public clients with PKCE. Check it took: `https://<instance>.clerk.accounts.dev/.well-known/oauth-authorization-server` lists a `registration_endpoint` once it is on. Without it, a client asks you for a client id, or fails to connect.

## Security

Three things open `/mcp`, each checked on every request:

- **A Clerk access token** for the Google account linked to this install, as a `Bearer` header. Omni holds no Clerk secret key: it asks Clerk's `userinfo` endpoint who the token belongs to and caches the answer for a minute, so a token revoked in Clerk can still work for up to that minute. Any other Google account gets a 401, and unlinking the account turns this way in off at once. A token never goes in a URL. If Clerk cannot be reached, `/mcp` answers 503 and the static tokens still work.
- **`data/mcp-token`** (mode 0600, made on first use), apart from the API token, as a header or in the path for clients that take only a URL. Anyone with that URL can start threads on your Mac, and threads run with `bypassPermissions`, so treat it like a password. To rotate it, delete the file, restart Omni and update each client that uses it.
- **The API token**, as a header only.

A 401 from `/mcp` names the protected resource metadata (`/.well-known/oauth-protected-resource/mcp`, RFC 9728), which points clients at Clerk. Omni also serves Clerk's own authorization server metadata at `/.well-known/oauth-authorization-server`, for clients on the older MCP spec. Both answer 404 until a Google account is linked.

Through Funnel, the `integrations.tailscaleLogin` check that guards `/api` does not apply, since Funnel requests carry no Tailscale login. Only `/mcp` and `/.well-known` are forwarded, and the tools reach `/api` in-process through the usual request guard. `/mcp` and the metadata also refuse a `Host` outside the allowed names, and `/mcp` refuses a browser `Origin` from another site: the same DNS-rebinding checks as `/api` (see [Remote access and security](remote-access.md)).

The server is stateless: each request gets a fresh MCP server, so a restart drops no session.
