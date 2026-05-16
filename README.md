# Ethora Chat Component — React Native (`@ethora/chat-component-rn`)

React Native chat UI + chat core for iOS and Android, powered by the Ethora platform (REST + XMPP). Mount a `<Chat />` component, point it at an Ethora app, and get a production-oriented mobile chat experience: rooms, threads, message history, media, push notifications, and pluggable auth.

**Part of the [Ethora SDK ecosystem](https://github.com/dappros/ethora#ecosystem)** — see all SDKs, tools, and sample apps. Follow cross-SDK updates in the [Release Notes](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

> Looking for the React.js (web) version? See [`@ethora/chat-component`](https://github.com/dappros/ethora-chat-component).

## What you get

- Room list and room chat UI (Native / iOS + Android)
- Message history (MAM), replies, edits, deletes
- Typing indicators
- Push notifications (FCM / APNs)
- Pluggable auth (default / JWT / injected user / custom)
- Custom message bubble, input, scroll, and day-separator overrides

## Default backend endpoints

The package defaults to the canonical Ethora Cloud endpoints:

| Purpose | Default value |
|---------|---------------|
| API base URL | `https://api.chat.ethora.com/v1` |
| XMPP WebSocket | `wss://xmpp.chat.ethora.com/ws` |
| XMPP host | `xmpp.chat.ethora.com` |
| XMPP MUC (conference) | `conference.xmpp.chat.ethora.com` |
| Web / sign up | `https://app.chat.ethora.com` |
| Swagger / API docs | `https://api.chat.ethora.com/api-docs/#/` |

To target QA, point the equivalent props/env vars at `chat-qa.ethora.com`. To self-host, override with your own `xmppSettings` and `baseUrl` — see the example below.

## Install

```bash
# inside an existing React Native project
npm install @ethora/chat-component-rn
# or
yarn add @ethora/chat-component-rn
```

iOS only:

```bash
cd ios && pod install
```

## Quick start

```tsx
import React from 'react';
import { SafeAreaView } from 'react-native';
import { Chat, XmppProvider } from '@ethora/chat-component-rn';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <XmppProvider>
        <Chat
          config={{
            appId: 'YOUR_APP_ID',
            baseUrl: 'https://api.chat.ethora.com/v1',
            xmppSettings: {
              devServer: 'wss://xmpp.chat.ethora.com/ws',
              host: 'xmpp.chat.ethora.com',
              conference: 'conference.xmpp.chat.ethora.com',
            },
          }}
        />
      </XmppProvider>
    </SafeAreaView>
  );
}
```

Sign up at [app.chat.ethora.com/register](https://app.chat.ethora.com/register) to get an `appId` (and optionally an app token / JWT for backend integrations). For a guided setup that writes config files into your project, run `npx @ethora/setup`.

## Authentication modes

```tsx
// JWT login (recommended for production apps that already have user auth)
<Chat config={{ jwtLogin: { enabled: true, token: 'PLACEHOLDER_JWT' } }} />

// Inject an already-authenticated user
<Chat
  config={{
    userLogin: {
      enabled: true,
      user: {
        _id: 'PLACEHOLDER_USER_ID',
        appId: 'PLACEHOLDER_APP_ID',
        firstName: 'Jane',
        lastName: 'Doe',
        token: 'PLACEHOLDER_ACCESS_TOKEN',
        refreshToken: 'PLACEHOLDER_REFRESH_TOKEN',
        xmppPassword: 'PLACEHOLDER_XMPP_PASSWORD',
        username: 'PLACEHOLDER_USERNAME',
        walletAddress: 'PLACEHOLDER_WALLET_ADDRESS',
        defaultWallet: { walletAddress: 'PLACEHOLDER_WALLET_ADDRESS' },
      },
    },
  }}
/>
```

## Pinning a single room

```tsx
<Chat
  roomJID="ROOM_JID@conference.xmpp.chat.ethora.com"
  config={{ setRoomJidInPath: false }}
/>
```

## Local development

This repo doubles as an Expo testbed app: `App.tsx` mounts
`AppLoginChatsRn`, a 3-tab (Setup / Chat / Logs) shell that drives the
SDK end-to-end via either paste-a-JWT or email + app-token login. Run
it against the canonical Ethora Cloud endpoints, your QA tenant, or a
self-hosted Ethora instance — all configurable from the Setup tab at
runtime.

### Prerequisites

- Node.js 18+
- Xcode 15+ (iOS), Android Studio with a working AVD (Android)
- Java JDK 17+ — Android Studio's bundled JBR works:
  `export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`
- Android SDK with platform-tools on `$PATH`:
  `export ANDROID_HOME="$HOME/Library/Android/sdk"`
- **CocoaPods 1.13+** for iOS. macOS system Ruby (2.6) is too old for
  the bundled Gemfile — install via Homebrew: `brew install cocoapods`

### Build + run

```bash
git clone https://github.com/dappros/ethora-chat-component-rn.git
cd ethora-chat-component-rn
npm install

# iOS
cd ios && pod install && cd ..
npx expo run:ios --device "iPhone 16"

# Android — write local.properties if expo prebuild didn't create it
echo "sdk.dir=$ANDROID_HOME" > android/local.properties
npx expo run:android
```

The first `expo run:*` will `expo prebuild` to generate `ios/` and
`android/` from `app.json`. Both directories are gitignored — the
source of truth is `app.json` + the config plugins it lists.

### Known first-run gotchas

- **iOS `pod install` fails on system Ruby**: the Gemfile resolves
  to ffi >= 1.17, which needs Ruby 3.0+. Install CocoaPods via
  `brew install cocoapods` (uses brew's bundled Ruby) and run
  `pod install` directly — skip Bundler.
- **`expo run:android` errors with "SDK location not found"**: write
  `android/local.properties` with `sdk.dir=$ANDROID_HOME` (the
  Expo prebuild flow doesn't currently generate this).
- **`expo run:ios` crashes at the very end on osascript**: the CLI
  tries to count Simulator processes via AppleScript and fails if
  Terminal lacks Automation permission. The build succeeds and the
  app is installed — grant permission via System Settings →
  Privacy & Security → Automation, or just open the Simulator
  manually before the build.
- **First-bundle ANR on Android emulator**: the debug bundle is
  ~1500 modules and the cold JS eval can briefly trip the watchdog
  on a fresh AVD. Tap "Wait" — the Setup tab will render. Release
  builds (Hermes precompiled) don't show this.

### `expo prebuild` and the `dependencies` guard

`npm run prebuild|ios|android` each chain through to `expo prebuild`
on first run, and `expo prebuild` likes to hoist `expo`, `react`,
and `react-native` from `devDependencies` into `dependencies`.
That's wrong for a published library — consumers of
`@ethora/chat-component-rn` would install a duplicate copy of React
and crash at runtime with the "two copies of React" reconciler
error.

To prevent the regression, those three npm scripts each invoke
`scripts/fix-prebuild-deps.js` right after, which surgically strips
the offending lines back out of `package.json` (preserving the rest
of the file byte-for-byte). You can also run it manually:

```bash
npm run fix-prebuild-deps
```

It's idempotent — runs are silent when there's nothing to fix.

### Tests

```bash
npm test                          # jest, ~2s for the full suite
npm test -- --watch               # watch mode
npm test -- some.test.ts          # single file
```

> Already have your RN environment set up? See the
> [React Native environment setup](https://reactnative.dev/docs/environment-setup)
> doc if any of the above feels unfamiliar.

## Related

- [`@ethora/chat-component`](https://github.com/dappros/ethora-chat-component) — React.js (web) chat SDK
- [`ethora-sdk-android`](https://github.com/dappros/ethora-sdk-android) — Native Android SDK (Kotlin / Compose)
- [`ethora-sdk-swift`](https://github.com/dappros/ethora-sdk-swift) — Native iOS SDK (Swift / SwiftUI)
- [`ethora-setup`](https://github.com/dappros/ethora-setup) — `npx @ethora/setup` to bootstrap an Ethora app
- [Ethora monorepo](https://github.com/dappros/ethora) — full ecosystem entry point
- API docs (Swagger): [api.chat.ethora.com/api-docs/#/](https://api.chat.ethora.com/api-docs/#/)

## Support

- Forum: <https://forum.ethora.com/>
- Discord: <https://discord.gg/Sm6bAHA3ZC>
- Status: <https://uptime.chat.ethora.com>

## License

AGPL. See [LICENSE](./LICENSE).
