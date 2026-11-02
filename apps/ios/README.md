# Omni OS for iOS

This development client pairs with an Omni server, reads its channels and threads, follows them live, starts new threads, sends messages to them, and pins, marks done, renames, moves and archives a thread from its menu or by swiping its row. Expo Go is not supported.

A thread has a composer pinned above the keyboard. While a turn runs, a message steers the agent when its harness can take input mid-turn and otherwise queues for after the turn, and the placeholder and the send button's label say which. A message shows in the thread as sending, and if the network fails it stays there with Retry, which sends it again under the same request id so the server answers with the first acceptance instead of taking the message twice, and Edit, which puts the text back in the box and focuses it. If the server got the message but its answer was lost, the failed row goes as soon as the thread stream shows it, so it never appears twice. Stop replaces Send when the box is empty and a turn can be stopped. Messages held after a server restart show Resume, which sends the ones that never reached the agent, and Discard on each. A message that may have reached the agent also shows Send again, as on the web.

New starts a thread, from the Channels screen (the Conductor is the first choice) or from inside a channel (that channel is). The sheet picks where it goes, takes the first message, and shows the model that channel or the Conductor role defaults to, the same as the phone web's New sheet. Tap the model to pick another model, an effort or Auto. Start creates the thread and opens it live. The app picks the thread's id, so if the network drops and Start is tried again, the server hands back the thread it already made and the first message goes once. Change the text, the channel or the model between tries and it is a new thread. A server that cannot be reached or that answers with an error keeps what you typed and offers Try again. A channel the server does not have comes back as a refusal with the server's message. A phone the server no longer accepts goes back to Connect.

What waits on you shows in the thread: answer a question the agent asked, retry a setup that failed, schedule or cancel a resume after a usage limit, and resume or discard messages the server held. Opening a thread marks its result read.

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

With no server paired the app shows Connect. Once one is, Channels is the home screen, and Servers (in its header) switches or removes servers and reaches Add server. The channel list, the thread view and the connection line come from `src/live/`, which talks to the active server through `@omni/client-core` with the token from the Keychain. Pairing's own calls use the same client.

A 401 anywhere, on a request or on a stream, makes the app ask the server whether it still accepts this phone. If it does not (the phone was revoked in Settings on the computer), the app forgets that server and shows Connect with a notice. Another paired server, if any, becomes active.

Requests never follow a redirect. `@omni/client-core` sends `redirect: 'manual'` and refuses a 3xx or an answer that came from another origin. On iOS, React Native's fetch ignores `redirect` and follows the redirect itself, but its redirect handler drops every request header, the token included, so what the client-core check adds there is that nothing from the other origin is read.

The Simulator has no camera, so use Enter code there.

### Development shortcut

A development build (`__DEV__`) with both `EXPO_PUBLIC_OMNI_DEV_URL` (for example `http://127.0.0.1:4757`) and `EXPO_PUBLIC_OMNI_DEV_TOKEN` set in the environment that starts Metro uses them as its session, but only while no server is paired. A release build ignores them. Expo inlines the token into the JavaScript bundle, so use a throwaway server's token, never a live one, and do not commit it.

## Push notifications

The server alerts a paired phone when a thread needs an answer, finishes or fails, or a crew member reports back. The server side is in `docs/internals/app-pairing.md`. The code here is in `src/notifications/`.

- **Permission.** After the first server is paired, a sheet explains the alerts once and offers "Turn on notifications". Only that button triggers the iOS prompt. "Not now" leaves iOS unasked, and Servers, then Notifications, turns them on later. A denied permission shows "Open Settings".
- **Registration.** Once allowed, the app sends the native APNs device token (not an Expo token) to every paired server with `PUT /api/auth/push-token`. It does so again on launch, when the app returns to the foreground, when a server is paired and when APNs announces a new token. Removing a server deletes the token first, then signs out.
- **Environment.** A development client (`__DEV__`) registers `sandbox` tokens and every other build `production`. An EAS `development` build is signed ad hoc and gets production tokens, so start Metro with `EXPO_PUBLIC_PUSH_ENVIRONMENT=production` to register under the right name. `app.config.ts` sets the `aps-environment` entitlement through the `expo-notifications` plugin (`production` for the `preview` and `production` EAS profiles).
- **Taps.** A tap opens the thread from a cold start, from the background and while the app is open. The alert names a thread and a channel but no server, so with several servers paired the app asks each one for the thread, active server first. A banner for the thread already on screen is suppressed.
- **Choices.** Servers, then Notifications, shows the four kinds per server. Each switch sends only its own key.

To try a tap without Apple, drop a payload on the Simulator:

```sh
xcrun simctl push <UDID> app.omni-os.ios payload.apns
```

where `payload.apns` is `{"aps":{"alert":{"title":"Omni OS","body":"A thread needs your answer."},"sound":"default"},"omni":{"kind":"needsInput","threadId":"<thread id>","channelId":"<channel id>"}}`. Real delivery needs the server's APNs key and a build signed with the Push Notifications capability, which the Simulator cannot prove.

## EAS builds

Run EAS commands from `apps/ios` after installing the EAS CLI and signing in to an Expo account. Configure the EAS project and Apple signing before building for a device or TestFlight. The profiles in `eas.json` are:

- `development` builds an internal development client.
- `development-simulator` builds the development client for the simulator.
- `preview` builds an internal distribution build.
- `production` builds a production release and increments its build number.

For example, run `eas build --platform ios --profile development-simulator` to build for the simulator. Physical devices and TestFlight require Apple Developer signing and an Expo account.

## Reference setup

The Expo, React Native, React Navigation, Effect, Uniwind, development client, and EAS setup follows T3 Code's mobile app at `c65f8d552baca1b51e15b5fb4737f07e18cce177`. Omni uses npm workspaces rather than T3's pnpm catalog. The navigation screens package uses the public 4.x release rather than T3's private 5.x fork. T3's unrelated native modules, authentication, widgets, and product-specific Expo configuration are not included in this placeholder app.
