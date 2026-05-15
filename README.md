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

This repo is bootstrapped with `@react-native-community/cli`. To run it as its own RN sample app rather than as a library:

```bash
git clone https://github.com/dappros/ethora-chat-component-rn.git
cd ethora-chat-component-rn
yarn install
cd ios && pod install && cd ..
yarn start            # Metro
yarn ios              # in another terminal
yarn android          # in another terminal
```

> Make sure you have completed the [React Native environment setup](https://reactnative.dev/docs/environment-setup) before proceeding.

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
