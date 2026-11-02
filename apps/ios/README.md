# Omni OS for iOS

This development client pairs with an Omni server and lists the servers it is paired with. It does not load threads yet. Expo Go is not supported.

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

The app accepts only an `https://` server origin. It checks the server's capabilities after pairing and whenever it returns to the foreground. If the server answers 401, the session was revoked: the app forgets that server and asks you to pair again. The contract is in `packages/shared/app-pairing.ts`.

The Simulator has no camera, so use Enter code there.

## EAS builds

Run EAS commands from `apps/ios` after installing the EAS CLI and signing in to an Expo account. Configure the EAS project and Apple signing before building for a device or TestFlight. The profiles in `eas.json` are:

- `development` builds an internal development client.
- `development-simulator` builds the development client for the simulator.
- `preview` builds an internal distribution build.
- `production` builds a production release and increments its build number.

For example, run `eas build --platform ios --profile development-simulator` to build for the simulator. Physical devices and TestFlight require Apple Developer signing and an Expo account.

## Reference setup

The Expo, React Native, React Navigation, Effect, Uniwind, development client, and EAS setup follows T3 Code's mobile app at `c65f8d552baca1b51e15b5fb4737f07e18cce177`. Omni uses npm workspaces rather than T3's pnpm catalog. The navigation screens package uses the public 4.x release rather than T3's private 5.x fork. T3's unrelated native modules, authentication, widgets, and product-specific Expo configuration are not included in this placeholder app.
