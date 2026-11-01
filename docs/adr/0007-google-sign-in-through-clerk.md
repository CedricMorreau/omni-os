# New devices sign in with Google through Clerk

Every client of an Omni install sends one token, `data/api-token` ([remote access](../user/remote-access.md#who-can-call-the-api)). A new phone or browser gets in by pasting it or opening a `?pair=` link that holds it. That works, but every device holds the install's master key, nothing records which devices have it, and the only way to shut one out is to rotate the token and pair all the others again.

## Decision

An install can link one Google account, through Clerk, as its owner. A device that signs in with Google as that account gets a session of its own, which the owner can see and revoke in Settings, Machines. The token stays as it was, for the Mac app, threads, scripts, the stdio MCP servers, and as the way in when Clerk or the network is down.

- **One shared Clerk instance, one owner per install.** Omni ships the publishable key of a Clerk instance where anyone can make an account with Google. Each install links exactly one Clerk user. Signing in as anyone else gets nothing. Two people never share an install. `integrations.clerkPublishableKey` and `integrations.clerkClientId` point an install at another instance.
- **The device authorization grant, not a redirect.** Every install has its own address (`127.0.0.1:4747`, a `.ts.net` name, a fork's host), and one OAuth app cannot list them all as redirect URIs. With RFC 8628 the server asks Clerk for a code, the device shows it and opens Clerk's page, the person approves, and the server polls Clerk. The device code never leaves the server. The client proves each poll with a secret only it holds. A browser gets its session as an HttpOnly cookie in the last poll's answer, and the page never sees it.
- **No Clerk secret on any machine.** Omni is a public client. The server checks the ID token's RS256 signature against the instance's JWKS, and its issuer, audience and expiry, with `node:crypto`. It takes the token directly from Clerk's token endpoint over TLS, so the signature check is a second line of defence.
- **Only the token links.** Linking or unlinking the owner needs a request that carried the token. A device that signed in can revoke devices and sign itself out, but cannot hand the install to another account. Linking a different account, or unlinking, ends every session.
- **Local, never synced.** `auth_owner` and `device_sessions` live in each machine's database. A session keeps only its token's SHA-256 and stops working after 90 days unused.

## Consequences

- The three sign-in routes (`GET /api/auth/methods`, `POST /api/auth/google/start`, `POST /api/auth/google/poll`) take no token. The rest of the request guard still applies to them (Host, Origin, Sec-Fetch-Site, JSON only). Starting a sign-in is capped at 10 open and 20 a minute.
- Google sign-in needs the network and Clerk to be up. Sessions issued earlier keep working offline, since the server checks them itself.
- The device grant can be phished: someone who can already reach the server starts a sign-in and sends the owner the link. The code is shown on both the device and Clerk's page so the owner can compare them, and only an approval by the owner's own account gives anything.
- Sync relay auth and MCP OAuth go through the same Clerk instance in later changes.

## Options turned down

- **Clerk's hosted components on each install's own domain.** A Clerk production instance only serves domains it knows, and every install has its own.
- **The authorization code flow with a loopback redirect.** That works only on the machine itself, which is the one place the token file is already readable.
- **Replacing the token with Clerk.** That would make Omni depend on the network for its own clients on the same Mac, and break the Mac app, the scripts and the stdio MCP servers that read the file.
