# Native app pairing contract

This contract describes version 1 of the native app pairing API. All routes are relative to the selected server's HTTPS origin. The server's existing host, origin, and request validation rules still apply. API errors are JSON objects with an `error` string. Shared TypeScript types live in `packages/shared/app-pairing.ts`.

## Pair a device

`POST /api/auth/app-pairings` requires the install token. It accepts an empty JSON object and returns `{ "code": "...", "expiresAt": "..." }`. The expiry is an ISO 8601 timestamp. Codes expire after 300 seconds and can be redeemed once. The server returns 429 with `Retry-After` when the creation limit is reached.

The QR payload is a JSON object with `version` set to `1`, `serverUrl` set to the server's HTTPS origin, and `code` set to the one-time code. It contains neither the install token nor the resulting app session token. Treat the code as a secret until it expires or is redeemed.

`serverUrl` is an HTTPS origin that the phone can reach from outside the computer. The settings card offers the origin of the page it is on, the Omni Connect address while its tunnel is connected, and an address the person types in, such as a Tailscale name. It never offers `localhost`, an IP address, a name without a dot, or a `.local` name. The server does not choose or check the address, so a client must show the person which address the QR names.

`POST /api/auth/app-pairings/redeem` requires no session. Send `{ "code": "...", "name": "..." }`, where `name` has 1 to 100 characters. The response is `{ "token": "...", "sessionId": "..." }`. Store the token in the phone's secure storage for that server, and send it as `Authorization: Bearer <token>` on subsequent requests. Invalid input returns 400. A missing, used, or expired code returns 404. Rate limits return 429 with `Retry-After`.

## Capabilities

`GET /api/capabilities` requires authentication. A version 1 response has this shape:

```json
{
  "api": 1,
  "auth": { "via": "session", "method": "pairing", "sessionId": "..." },
  "pairing": { "app": true, "codeTtlSeconds": 300 },
  "push": { "registration": true, "delivery": false },
  "streams": { "sse": true, "closeOnRevoke": true }
}
```

For install-token authentication, `auth.via` is `token`, and `auth.method` and `auth.sessionId` are null. A Google session has `auth.method` set to `google`. Push delivery is not implemented. Clients must reject API versions they do not support rather than assume an unknown response is compatible.

## Sessions

`GET /api/auth/devices` lists sessions, including the `method` field (`google` or `pairing`). `DELETE /api/auth/devices/:id` revokes one session. The install token and Google sessions can revoke any session. A pairing session can revoke only itself and gets 403 for any other id. `POST /api/auth/signout` revokes the caller's session. Only requests that carry the install token can call `POST /api/auth/pair`, so a session cannot swap itself for the install token. A revoked session cannot make subsequent HTTP requests, and its open SSE connections close. Sessions expire after 90 days without an authenticated request. An open SSE connection does not count as an authenticated request after it starts. The server checks open streams for expired sessions every 15 seconds. A pairing session is local to the selected server and does not require a linked Google account. Linking or unlinking a Google account does not revoke pairing sessions.

## Push registration

`PUT /api/auth/push-token` requires an app session and returns 401 if the session ended while the request was in flight. Send `token`, a hexadecimal APNs device token, `platform: "ios"`, `environment: "sandbox"` or `"production"`, and an optional `bundleId`. Registering again replaces that session's registration. The server associates a token with at most one session.

`GET /api/auth/push-token` returns whether a token is registered and its metadata, but never returns the token. `DELETE /api/auth/push-token` removes the registration and is idempotent. Revoking a session removes its registration. Registration does not send notifications. A push is a wake-up signal; HTTP and SSE remain the source of truth.

## What revoking does and does not stop

A pairing session has the same API access as a Google session. It can open the thread terminal and start agents, and both run code as the user who runs the server. That code can read `data/api-token`, and every agent receives the install token in its environment. Revoking a session ends that token's access to HTTP and SSE. It does not undo what the session already ran, and it does not remove anything that code installed.

So revoke protects against a lost or stolen token that nobody has used yet. For a device that has already run commands, revoke it, then rotate the install token and check the machine. The API has no route-level limit for pairing sessions, because the terminal, threads, automations and mods all run code. A reduced-capability session would need an allowlist of routes. That is a product decision this contract does not make.

## Notes for the iOS client

- Store the session token in the Keychain, one entry per server. Never put it in `UserDefaults`, logs or crash reports.
- Take `serverUrl` from the QR and use only that origin. Do not follow redirects to another origin with the token.
- Call `GET /api/capabilities` after pairing and on each launch. If `api` is not a version the app supports, stop and tell the person to update the app or the server.
- Treat a 401 from any request or SSE connection as the end of the session. Delete the token and the cached data for that server and show the pairing screen. Do not retry.
- Register the push token after pairing and again when APNs gives a new one. Registering again replaces the old one. Delete it on sign-out.
- A push only tells the app to fetch. Read state over HTTP and SSE.
- A code works once. If redeeming fails with 404, ask for a new code. If it fails with 429, wait for `Retry-After`.
