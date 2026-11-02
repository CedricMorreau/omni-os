# Omni OS for iOS

This development client pairs with an Omni server, then reads its channels and threads and follows them live. It is read only: sending messages comes in a later milestone. Expo Go is not supported.

## Run on the iOS simulator

Install Xcode, an iOS simulator runtime, Node 24.3 or later in the 24.x line or Node 26 or later, npm 11.19.0, and CocoaPods. From the repository root:

```sh
npm ci --include=dev
npm run ios --workspace @omni/ios
```

Expo generates the native project and opens a development build in the simulator. For later sessions, start Metro with:

```sh
npm run dev --workspace @omni/ios
```

Open the installed Omni OS development client and select the Metro server. If the simulator cannot reach Metro, run Metro on the Mac and use its loopback address.

## Connect to a server

Make a pairing code on your computer, then scan its QR code or type the server address and code. The app trades the code for a session token and keeps the token in the Keychain, one entry per server. Pair several servers and switch between them from the Servers screen.

The app accepts only an `https://` server origin. It checks the server's capabilities after pairing and whenever it returns to the foreground. The contract is in `packages/shared/app-pairing.ts`.

With no server paired the app shows Connect. Once one is, the app opens on three native tabs, Activity, Channels and Library, in phone web's order. Activity is home: it shows what needs you, what runs, your pins, the latest threads and what finished today, and its tab carries the needs-you count. Each tab keeps its own stack, so a thread opens inside the tab you tapped it in, and the tab bar hides on pushed screens. Search (left of each tab's header) and Settings (right) open from every tab root. Settings reaches Servers, which switches or removes servers and reaches Add server. The channel list, Activity, the thread view and the connection line come from `src/live/`, which talks to the active server through `@omni/client-core` with the token from the Keychain. Pairing's own calls use the same client.

A 401 anywhere, on a request or on a stream, makes the app ask the server whether it still accepts this phone. If it does not (the phone was revoked in Settings on the computer), the app forgets that server and shows Connect with a notice. Another paired server, if any, becomes active.

Requests never follow a redirect. `@omni/client-core` sends `redirect: 'manual'` and refuses a 3xx or an answer that came from another origin. On iOS, React Native's fetch ignores `redirect` and follows the redirect itself, but its redirect handler drops every request header, the token included, so what the client-core check adds there is that nothing from the other origin is read.

The Simulator has no camera, so use Enter code there.

## Search and Settings

Search lists the latest threads until you type. After 200 ms of quiet it asks the server's `/search`, which matches every word as a prefix in thread titles and messages, and shows matching channels above the thread hits. A hit opens its thread. It does not scroll to the matching message yet, because the Thread screen takes only an id.

Settings is a grouped list. Servers is the pairing screen. Notifications opens the `NotificationSettings` route once a stack registers it, and shows "Not available yet" until then. Devices lists who is signed in to the active server and revokes one. A paired phone can revoke only itself, and the server's refusal is shown as it is. Automations lists the server's automations and pauses or resumes one, as phone web does. Sign out of a server is the same as removing it: the phone tells the server, then forgets the token. The footer shows the app version.

These screens call the server through `hub.call` (`src/live/hub.ts`), which retries once after a 401 like the live lists, and `useRemote` (`src/live/use-remote.ts`) for lists the live feed does not carry. Appearance follows the system theme. Workspace, Machines, Sync, Integrations, Harness config, Secrets and About stay in the Web UI and the Mac app.

## Library and artifacts

The Library tab lists the 60 newest files the agents made, as phone web does, with the same filters (All, Pages, Images, Docs, Data, from `@omni/shared/artifacts.ts`). It loads when a server opens, refetches once after a burst of changed files (1.5 seconds of quiet), and again after a reconnect or a return to the foreground. A failed refresh keeps the list on screen and says so. Pull down to refresh.

Tapping a file opens the Artifact screen. `openArtifact(navigation, artifact)` in `src/navigation/open-artifact.ts` is the one entry the thread body calls. The route is registered in every tab's stack, so it opens inside the tab you are in. The screen follows the newest version of the file from the Library's live list.

| Kind | Shown as |
| --- | --- |
| html | A sandboxed web view, scripts on |
| svg | An image in a web view, so no script runs |
| markdown | Rendered by `marked` in a web view, scripts off |
| image, screenshot | Native, pinch to zoom |
| pdf | A web view on the cached file, scripts off |
| csv | A native grid of the first 500 rows |
| json, text | Selectable text, JSON pretty-printed, cut at 200,000 characters |
| anything else | A Quick Look button |

Share sends a copy under the file's real name. "claude.ai" shows for a published file and opens its page. There is no "open raw URL in browser" because that URL needs the bearer token.

### How the web view is kept apart from the app

The app fetches the file in native code with the token (`hub.fetchArtifactFile`, over `requestBytes`) and writes it to the cache. The web view gets the content and nothing else. All web views are `src/components/artifact/SandboxWebView.tsx`, with props from `src/artifacts/sandbox.ts`.

- No `onMessage`. react-native-webview adds `window.ReactNativeWebView` and a message handler only when it is set, so a page has no way to call the app.
- No injected script, `baseUrl` or request headers. The page has no origin on the server and the token is never in the web view's memory.
- A Content-Security-Policy meta goes first in the document. It sets `connect-src 'none'`, `frame-src 'none'`, `form-action 'none'` and `base-uri 'none'`, so a page cannot call out or post.
- `onShouldStartLoadWithRequest` decides every move. A tapped http(s) link opens in the system browser. Redirects, script navigation, frames and other schemes are blocked.
- Incognito, no cache, no cookies, no file access.
- Markdown shows raw HTML as text and drops links and image sources that are not web, mail or `https`.

`tests/sandbox.test.ts` and `tests/markdown.test.ts` hold these rules. Manual check on a throwaway server: publish an HTML artifact that reads `window.ReactNativeWebView`, `localStorage` and `document.cookie`, calls `fetch` on the server and `/api`, sets `location`, submits a form and adds an iframe, and prints each result. Every call must fail or be undefined.

### Development shortcut

A development build (`__DEV__`) with both `EXPO_PUBLIC_OMNI_DEV_URL` (for example `http://127.0.0.1:4757`) and `EXPO_PUBLIC_OMNI_DEV_TOKEN` set in the environment that starts Metro uses them as its session, but only while no server is paired. A release build ignores them. Expo inlines the token into the JavaScript bundle, so use a throwaway server's token, never a live one, and do not commit it.

## EAS builds

Run EAS commands from `apps/ios` after installing the EAS CLI and signing in to an Expo account. Configure the EAS project and Apple signing before building for a device or TestFlight. The profiles in `eas.json` are:

- `development` builds an internal development client.
- `development-simulator` builds the development client for the simulator.
- `preview` builds an internal distribution build.
- `production` builds a production release and increments its build number.

For example, run `eas build --platform ios --profile development-simulator` to build for the simulator. Physical devices and TestFlight require Apple Developer signing and an Expo account.

## Reference setup

The Expo, React Native, React Navigation, Effect, Uniwind, development client, and EAS setup follows T3 Code's mobile app at `c65f8d552baca1b51e15b5fb4737f07e18cce177`. Omni uses npm workspaces rather than T3's pnpm catalog. The navigation screens package uses the public 4.x release rather than T3's private 5.x fork. T3's unrelated native modules, authentication, widgets, and product-specific Expo configuration are not included in this placeholder app.
