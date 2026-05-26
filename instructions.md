# Configuring `@ethora/chat-component-rn`

This document walks through the `config` object that `<XmppProvider>` and `<Chat>` accept in React Native. Field semantics are intentionally aligned with the web package [`@ethora/chat-component`](https://www.npmjs.com/package/@ethora/chat-component); fields below are the ones that are wired up and verified on RN. Anything web-only (DOM/CSS) is called out as `web-only`.

The canonical TypeScript surface is [`src/types/types.ts → IConfig`](src/types/types.ts). When adding a field, edit the interface there — `src/types/models/config.model.ts` re-exports it so legacy import paths keep working.

## Table of contents

- [Reference example](#reference-example)
- [Single-init contract](#single-init-contract)
- [Config reference](#config-reference)
  - [Core](#core)
  - [Authentication](#authentication)
  - [XMPP / network](#xmpp--network)
  - [Bootstrap](#bootstrap)
  - [Header and navigation](#header-and-navigation)
  - [Room list](#room-list)
  - [Chat info panel](#chat-info-panel)
  - [Messaging and interactions](#messaging-and-interactions)
  - [Typing and sending control](#typing-and-sending-control)
  - [Notifications](#notifications)
  - [Push notifications](#push-notifications)
  - [Theming and styling](#theming-and-styling)
  - [Translations](#translations)
  - [Event hooks](#event-hooks)
- [Field-by-field gloss of the reference example](#field-by-field-gloss-of-the-reference-example)
- [Per-room behavior: single-room patient view](#per-room-behavior-single-room-patient-view)
- [See also](#see-also)

## Reference example

The canonical pattern: `XmppProvider` holds the connection lifecycle (one place, one socket). `Chat` is just the UI. Most fields on `Chat config` are UI/behavior toggles — but a few **must** match what you passed into `XmppProvider config` (`baseUrl`, `xmppSettings`, `jwtLogin/userLogin/customAppToken`, `refreshTokens`, `initBeforeLoad`). The provider initializes the network; `Chat` reuses the singleton via context.

```tsx
import { Chat, XmppProvider } from '@ethora/chat-component-rn';

const baseConfig = {
  customAppToken: token || '',
  baseUrl: config.base_url,
  xmppSettings: {
    devServer: config.dev_server,
    host: config.host,
    conference: config.conference,
  },
  jwtLogin: {
    enabled: true,
    token: token || '',
  },
  refreshTokens: { enabled: true },
  initBeforeLoad: true,
} as const;

<XmppProvider
  data-testid="xmpp-provider"
  config={baseConfig}
>
  …
</XmppProvider>;

<Chat
  data-testid="chat-component"
  roomJID={room_jid}
  config={{
    ...baseConfig,
    newArch: true,
    disableInteractions: true,
    disableChatInfo: {
      disableHeader: false,
      disableDescription: true,   // hide chat description
      disableType: true,          // hide chat type
      disableMembers: true,       // member list shown but not clickable
      disableChatHeaderMenu: true, // hide Report / Leave
    },
    chatHeaderSettings: {
      hide: false,
      disableCreate: true,        // hide "New chat room" button
      disableMenu: true,          // hide Profile / Settings / Logout
      hideSearch: renderOneChatRoom,
    },
    clearStoreBeforeInit: true,
    disableNewChatButton: true,
    disableRoomConfig: true,
    disableProfilesInteractions: true,

    // patient single-room view
    disableRoomMenu: renderOneChatRoom,
    disableRooms: renderOneChatRoom,
    enableRoomsRetry: {
      enabled: true,
      helperText: translate('pages.patientMessages.initializing'),
    },
  }}
/>;
```

> `data-testid` is web-only — RN ignores it. Use `testID` for native e2e drivers.

## Single-init contract

To avoid duplicate XMPP WebSocket connections — same contract as the web package:

- **`initBeforeLoad: true`** → `XmppProvider` is the only place that opens the socket. `Chat` does not re-init; it reuses the singleton from context.
- **`initBeforeLoad` omitted/false** → `Chat` initializes XMPP from its own `useChatWrapperInit` effect (legacy path). Don't combine modes — pick one.

`config.xmppSettings.devServer` is treated as the WebSocket host on RN; the SDK constructs `wss://<devServer>/ws` internally.

## Config reference

> Defaults below reflect what `src/types/types.ts:IConfig` ships with today. Boolean toggles are all "off by default" unless stated.

### Core

| Option | Type | Description |
| --- | --- | --- |
| `appId` | `string` | App identifier sent in REST requests / app-token context. |
| `baseUrl` | `string` | API base URL. Default: `https://api.chat.ethora.com/v1`. Point at `chat-qa.ethora.com` for QA, or your self-host. |
| `customAppToken` | `string` | App-level JWT used in the `Authorization` header for endpoints like `/users/login-with-email`. Required for email login. |
| `projectName` | `string` | Free-form project label, surfaced in dev logs. |

### Authentication

Pick **one** auth mode. Mixing is undefined behavior.

| Option | Type | Description |
| --- | --- | --- |
| `jwtLogin` | `{ enabled: boolean; token: string; handleBadlogin?: React.ReactElement }` | Exchange a client JWT via `POST /users/client`. Backwards-compatible — prefer `userLogin`/`customLogin` for new integrations. |
| `userLogin` | `{ enabled: boolean; user: User \| null }` | Inject a pre-resolved user (your own auth flow). The user object must include `token`, `xmppUsername`, `xmppPassword`. |
| `customLogin` | `{ enabled: boolean; loginFunction: () => Promise<User \| null> }` | Async login function the SDK calls during bootstrap. |
| `googleLogin` | `{ enabled: boolean; firebaseConfig: FBConfig }` | Google sign-in via Firebase. |
| `defaultLogin` | `boolean` | Legacy: enables built-in login form. Ignored when one of the above is set. |
| `refreshTokens` | `{ enabled: boolean; refreshFunction?: () => Promise<{ accessToken; refreshToken? } \| null> }` | Token-refresh strategy. With `enabled: true` and no `refreshFunction`, the SDK uses the canonical `/users/refresh` endpoint. |

### XMPP / network

| Option | Type | Description |
| --- | --- | --- |
| `xmppSettings.devServer` | `string` | XMPP WebSocket host. Default `xmpp.chat.ethora.com`. |
| `xmppSettings.host` | `string` | XMPP server domain (used in JIDs and SASL). |
| `xmppSettings.conference` | `string` | MUC conference subdomain. Default `conference.<host>`. |
| `xmppSettings.xmppPingOnSendEnabled` | `boolean` | Send a ping immediately before a message to validate the socket. |
| `xmppSettings.historyQoS` | `HistoryQoSConfig` | Tuning for the MAM-history preload scheduler. |
| `disableLastRead` | `boolean` | Skip the `chatjson:store` private-store read/write (unread tracking off). |
| `historyQoS` | `HistoryQoSConfig` | Top-level mirror of `xmppSettings.historyQoS`; either works. |

### Bootstrap

| Option | Type | Description |
| --- | --- | --- |
| `initBeforeLoad` | `boolean` | Provider owns the XMPP init — see [single-init contract](#single-init-contract). |
| `initBeforeLoadAuth.myEndpoint` | `string` | Override the `/users/client` style endpoint used by the bootstrap auth. |
| `clearStoreBeforeInit` | `boolean` | Wipe persisted Redux state on init. Useful when switching tenants. |
| `newArch` | `boolean` | Use the REST-first room-loading path (faster cold start). Recommended. |
| `useStoreConsoleEnabled` | `boolean` | Stream every dispatched action to `console.log`. Dev-only. |

### Header and navigation

| Option | Type | Description |
| --- | --- | --- |
| `disableHeader` | `boolean` | Hide the chat-screen header entirely. |
| `chatHeaderBurgerMenu` | `boolean` | Show a burger-menu toggle in the chat header. |
| `chatHeaderSettings.hide` | `boolean` | Hide the room-list header. |
| `chatHeaderSettings.disableCreate` | `boolean` | Hide the "New chat" button. |
| `chatHeaderSettings.disableMenu` | `boolean` | Hide the Profile/Settings/Logout drawer. |
| `chatHeaderSettings.hideSearch` | `boolean` | Hide the search bar above the chat list. |
| `chatHeaderAdditional` | `{ enabled: boolean; element: () => React.ReactNode }` | Inject a custom element below the header. |
| `headerLogo` | `string \| React.ReactElement` | Replace the default "Chats" label with a logo / custom element. |
| `headerMenu` | `() => void` | Tap handler for the room-list burger menu. |
| `headerChatMenu` | `() => void` | Tap handler for the chat-screen header menu. |

### Room list

| Option | Type | Description |
| --- | --- | --- |
| `disableRooms` | `boolean \| value` | Don't render the room list (single-room mode). Truthy hides it. |
| `disableRoomMenu` | `boolean` | Hide the room context menu. |
| `disableNewChatButton` | `boolean` | Hide the "+" button to create rooms. |
| `disableRoomConfig` | `boolean` | Disable room-settings entry points. |
| `forceSetRoom` | `boolean` | Force the initial room set even when the URL says otherwise. |
| `defaultRooms` | `string[] \| ConfigRoom[]` | Seed rooms to join on bootstrap. |
| `customRooms` | `{ rooms; disableGetRooms?; singleRoom }` | Fully app-controlled room source. Skips REST `/chats/my` when `disableGetRooms: true`. |
| `enableRoomsRetry` | `{ enabled: boolean; helperText: string }` | Show a retry UI if the rooms list fails to load. |
| `setRoomJidInPath` | `boolean` | web-only. No-op on RN. |
| `qrUrl` | `string` | Base URL the deep-link QR scanner resolves against. |

### Chat info panel

| Option | Type | Description |
| --- | --- | --- |
| `disableChatInfo.disableHeader` | `boolean` | Hide the info-screen header. |
| `disableChatInfo.disableDescription` | `boolean` | Hide the description row. |
| `disableChatInfo.disableType` | `boolean` | Hide the chat-type row (public/private). |
| `disableChatInfo.disableMembers` | `boolean` | Show members but disable tapping into a member profile. |
| `disableChatInfo.hideMembers` | `boolean` | Hide the members section entirely. |
| `disableChatInfo.disableChatHeaderMenu` | `boolean` | Hide the "Report" and "Leave" overflow options. |

### Messaging and interactions

| Option | Type | Description |
| --- | --- | --- |
| `disableInteractions` | `boolean` | Disable the long-press message-actions menu. |
| `disableReactions` | `boolean` | Disable emoji reactions UI. |
| `disableProfilesInteractions` | `boolean` | Don't link sender avatars/names to a profile screen. |
| `disableUserCount` | `boolean` | Hide the participant count in the header. |
| `disableSentLogic` | `boolean` | Skip the optimistic "sent/sending/failed" state machine. |
| `disableMedia` | `boolean` | Hide the attach button and the media-picker flows. |
| `botMessageAutoScroll` | `boolean` | Auto-scroll to bottom when a bot message arrives, even if the user has scrolled up. |
| `blockMessageSendingWhenProcessing` | `boolean \| { enabled; timeout?; onTimeout? }` | Disable the input while the last send is in flight; optional timeout that fires `onTimeout(roomJID)`. |
| `messageTextFilter` | `{ enabled: boolean; filterFunction: (text: string) => string }` | Mutate outgoing message text (e.g. profanity filter). |
| `secondarySendButton` | `{ enabled; messageEdit; buttonText?; label?; buttonStyles?; hideInputSendButton?; overwriteEnterClick? }` | A second send action (e.g. "Send & post") next to the input. |
| `whitelistSystemMessage` | `string[]` | Render only the listed `isSystemMessage` types. |
| `customSystemMessage` | `React.ComponentType<MessageProps>` | Replace the default system-message bubble. |

### Typing and sending control

| Option | Type | Description |
| --- | --- | --- |
| `disableTypingIndicator` | `boolean` | Disable both incoming render and outgoing composing-stanza emission. |
| `customTypingIndicator` | `{ enabled; text?; position?; styles?; customComponent? }` | Custom typing-indicator content + placement (`bottom \| top \| overlay \| floating`). |

### Notifications

| Option | Type | Description |
| --- | --- | --- |
| `inAppNotifications.enabled` | `boolean` | In-app toast on new messages. |
| `inAppNotifications.showInContext` | `boolean` | Show a toast even when the message arrives in the currently open room. |
| `inAppNotifications.maxNotifications` | `number` | Cap concurrent on-screen toasts. |
| `inAppNotifications.duration` | `number` | Auto-dismiss after N ms. |
| `inAppNotifications.position` | `{ horizontal?; vertical?; offset? }` | Toast placement. |
| `inAppNotifications.onClick` | `(params) => void \| Promise<void>` | Tap handler. Args: `{ roomJID, messageId, message, roomName, senderName }`. |
| `inAppNotifications.customComponent` | `React.ComponentType<…>` | Replace the default toast renderer. |

### Push notifications

Native push on RN uses FCM/APNs through Firebase. The host app owns the FCM/APNs token lifecycle and registers it with the SDK; the SDK is responsible for the `/users/subscribe-room` calls.

| Option | Type | Description |
| --- | --- | --- |
| `pushNotifications.enabled` | `boolean` | Master switch. |
| `pushNotifications.iconPath` | `string` | OS notification icon override. |
| `pushNotifications.badgePath` | `string` | OS badge override (falls back to `iconPath`). |
| `pushNotifications.firebaseConfig` | `FBConfig` | Firebase config for the messaging service. |
| `pushNotifications.onClick` | `(params) => void \| Promise<void>` | Fires when the user taps a push, including cold-start. Args: `{ roomJID?, messageId?, data?, notification? }`. |
| `pushNotifications.onNotificationPress` | `(data) => void` | Legacy alias of `onClick`; prefer `onClick`. |

### Theming and styling

| Option | Type | Description |
| --- | --- | --- |
| `colors.primary` | `string` | Brand color for active states, send button, badges. |
| `colors.secondary` | `string` | Tint color for backgrounds and chips. |
| `messageColor` | `{ backgroundMessage; backgroundMessageUser; colorUser; color }` | Bubble background and text colors for "them" and "me". |
| `backgroundChat` | `{ color?: string; image?: string \| ImageSourcePropType }` | Chat-screen background. |
| `bubleMessage` | `MessageBubble` | Bubble shape tokens — see `src/types/types.ts:MessageBubble`. |
| `roomListStyles` | `ViewStyle` | RN style overrides for the room-list pane. |
| `chatRoomStyles` | `ViewStyle` | RN style overrides for the chat pane. |
| `keyboardVerticalOffset` | `number` | Pass-through to `KeyboardAvoidingView`. Default `iOS: 130 / Android: 100` in the testbed. |

### Translations

| Option | Type | Description |
| --- | --- | --- |
| `translates.enabled` | `boolean` | Enable in-chat translation UI. |
| `translates.translations` | `Iso639_1Codes` | Default target language. |
| `enableTranslates` | `boolean` | Shorthand for `translates.enabled`. |

### Event hooks

| Option | Type | Description |
| --- | --- | --- |
| `eventHandlers.onMessageSent` | `(event) => void \| Promise<void>` | Fires once a message clears the optimistic pending state. Args: `{ message, roomJID, user, messageType, metadata? }`. |
| `eventHandlers.onMessageFailed` | `(event) => void` | Fires on send failure. Args: `{ message, roomJID, error, messageType }`. |
| `eventHandlers.onMessageEdited` | `(event) => void` | Args: `{ messageId, newMessage, roomJID, user }`. |

> ⚠️ Functions are not persisted in Redux. The chat layer merges `eventHandlers` from props on top of the config snapshot at runtime — see `src/components/MainComponents/ChatRoom.tsx`.

## Field-by-field gloss of the reference example

| Field | What it does in the reference snippet |
| --- | --- |
| `customAppToken: token` | App-level JWT for backend requests that need it (email login, refresh, etc.). |
| `baseUrl` | REST root. Match it across provider + chat or you'll get two REST clients. |
| `xmppSettings.{devServer, host, conference}` | WebSocket host, JID domain, MUC subdomain. Same trio in both places. |
| `jwtLogin.{enabled, token}` | Use the JWT path; the SDK calls `POST /users/client` with `x-custom-token: <token>` to mint the chat user. |
| `refreshTokens.enabled: true` | The SDK auto-refreshes via the canonical endpoint when the API returns 401. |
| `initBeforeLoad: true` | Provider opens the socket. `Chat` reuses the singleton. **Must be matching in both places.** |
| `newArch: true` | REST-first room loading. Faster than the legacy "wait for `getRoomsStanza`" path. |
| `disableInteractions: true` | No long-press menu on messages. Use this for view-only / patient chats. |
| `disableChatInfo.*` | Granularly hides parts of the chat-info screen (description, type, header overflow menu). |
| `chatHeaderSettings.*` | Hides "+ New chat", the user drawer; conditional `hideSearch` for single-room view. |
| `clearStoreBeforeInit: true` | Forces a clean Redux state on launch. Good for switching tenants/users. |
| `disableNewChatButton`, `disableRoomConfig`, `disableProfilesInteractions` | Lock the surface down so end-users can't navigate out of the chat into admin UI. |
| `disableRoomMenu: renderOneChatRoom`, `disableRooms: renderOneChatRoom` | Single-room patient view: when the boolean `renderOneChatRoom` is `true`, the room list and its menu are both hidden, so the user lands directly in the one chat they own. |
| `enableRoomsRetry.{enabled, helperText}` | Show a retry UX with localized helper text if the rooms load fails. |

## Per-room behavior: single-room patient view

When a tenant only ever has one room per user (e.g. a patient ↔ care-team thread), set:

```ts
disableRooms: true,
disableRoomMenu: true,
disableNewChatButton: true,
chatHeaderSettings: { hide: false, disableCreate: true, disableMenu: true, hideSearch: true },
```

…and pass the room JID directly:

```tsx
<Chat roomJID="patient-7c2f@conference.xmpp.chat.ethora.com" config={…} />
```

The room list code paths short-circuit and the user lands in the chat directly. If the room hasn't synced yet, `enableRoomsRetry` shows a retry button with the helper text you set.

## See also

- [README.md](README.md) — install, quick start, default endpoints.
- [src/types/types.ts](src/types/types.ts) — canonical `IConfig`.
- [FLOW_PARITY.md](FLOW_PARITY.md) — feature parity vs the web package.
- [CHANGELOG.md](CHANGELOG.md) — version history.
- Web equivalent docs: <https://www.npmjs.com/package/@ethora/chat-component>
