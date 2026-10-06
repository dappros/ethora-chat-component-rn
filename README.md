# Ethora Chat Component — React Native (`@ethora/chat-component-rn`)

React Native chat UI + chat core for iOS and Android, powered by the Ethora platform (REST + XMPP). Mount a `<Chat />` component, point it at an Ethora app, and get a production-oriented mobile chat experience: rooms, threads, message history, media, push notifications, and pluggable auth.

**Part of the [Ethora SDK ecosystem](https://github.com/dappros/ethora#ecosystem)** — see all SDKs, tools, and sample apps. Follow cross-SDK updates in the [Release Notes](https://github.com/dappros/ethora/blob/main/RELEASE-NOTES.md).

> Looking for the React.js (web) version? See [`@ethora/chat-component`](https://github.com/dappros/ethora-chat-component) (npm: [`@ethora/chat-component`](https://www.npmjs.com/package/@ethora/chat-component)).

## Table of contents

- [What you get](#what-you-get)
- [Default backend endpoints](#default-backend-endpoints)
- [Install](#install)
- [Quick start](#quick-start)
- [Configuration](#configuration) — full `IConfig` reference in [instructions.md](instructions.md)
- [Authentication modes](#authentication-modes)
- [Pinning a single room](#pinning-a-single-room)
- [Unread tracking in tab-based hosts](#unread-tracking-in-tab-based-hosts)
- [Logging out](#logging-out)
- [Customization flags worth knowing](#customization-flags-worth-knowing)
- [Message reactions](#message-reactions)
- [Replies & threads](#replies--threads)
- [Keyboard handling](#keyboard-handling)
- [Header height & font sizing](#header-height--font-sizing)
- [Dark theme](#dark-theme)
- [Quality & test coverage](#quality--test-coverage)
- [Local development](#local-development)
- [Changelog](CHANGELOG.md)

## What you get

- Room list and room chat UI (Native / iOS + Android)
- Message history (MAM), replies, edits, deletes
- Typing indicators
- Push notifications — bring your own token (Firebase or Expo), the SDK registers it and handles taps
- Pluggable auth (default / JWT / injected user / custom)
- Custom message bubble, input, scroll, and day-separator overrides
- Cross-session unread tracking with built-in badges — see [docs/unread-tracking.md](docs/unread-tracking.md)

## Default backend endpoints

The package defaults to the canonical Ethora Cloud endpoints:

| Purpose | Default value |
|---------|---------------|
| API base URL | `https://api.chat.ethora.com` (the API root — the SDK versions each path itself; a legacy `.../v1` is accepted and normalised) |
| XMPP WebSocket | `wss://xmpp.chat.ethora.com/ws` |
| XMPP host | `xmpp.chat.ethora.com` |
| XMPP MUC (conference) | `conference.xmpp.chat.ethora.com` |
| Web / sign up | `https://app.chat.ethora.com` |
| Swagger / API docs | `https://api.chat.ethora.com/api-docs/#/` |

To target a QA or staging environment, point the equivalent props/env vars at that environment's API + XMPP hosts. To self-host, override with your own `xmppSettings` and `baseUrl` — see the example below.

## Install

### 1. Add the SDK and required peers

```bash
npm install @ethora/chat-component-rn
# Required peer dependencies (one shot via expo install picks RN-compatible versions)
npx expo install \
  react react-native \
  @react-native-async-storage/async-storage \
  react-native-get-random-values \
  react-native-gesture-handler \
  react-native-reanimated \
  react-native-svg
```

### 2. Install the Expo packages used by media features

Image / video / document / audio send & receive, HEIC→JPEG conversion, profile-picture upload, and save-to-camera-roll all use the Expo modules below. They're declared as **optional** peer dependencies — if you don't install them, the corresponding picker / playback surfaces just no-op at runtime — but in practice every consumer wants them.

```bash
npx expo install \
  expo-audio expo-video expo-clipboard expo-document-picker \
  expo-image-manipulator expo-image-picker expo-media-library expo-blur
```

> `expo-blur` is only used to frost the chat picture as the chat-profile header collapses. Skip it and that layer falls back to a plain dim — everything else is unaffected.

> Two more optional peers: `expo-haptics` (a short haptic tap when the message menu opens on long-press; without it the gesture is silent) and `react-native-mmkv` (the chat cache is stored in MMKV with native encryption; without it the SDK falls back to AsyncStorage with AES on the JS thread — noticeably slower with many rooms). Both need a native rebuild after installing.

> Video playback uses **`expo-video`** (`useVideoPlayer` / `VideoView`) and audio uses **`expo-audio`** (`createAudioPlayer` / `useAudioRecorder`). Install both. The discontinued `expo-av` is no longer used anywhere in the SDK, so consumers on Expo SDK 57 / RN 0.86 with the New Architecture can drop it.

> No `metro.config.js` shim is required. As of `26.5.5` the SDK no longer statically imports any legacy `react-native-*` native modules; the bundled `withEthoraShims` helper is preserved as a no-op for backward compat with older setups.

### 3. iOS pods

```bash
cd ios && pod install
```

After `npx expo prebuild` (or first `npm run ios` in an Expo project), the pods install runs automatically.

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
            baseUrl: 'https://api.chat.ethora.com',
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

## Configuration

`<XmppProvider>` and `<Chat>` accept the same `config` object (shape: [`IConfig`](src/types/types.ts)). Real integrations should put the network/auth fields on the provider (single source of truth for the XMPP socket) and the UI/behavior toggles on the chat:

```tsx
const baseConfig = {
  customAppToken: token || '',
  baseUrl: backend.base_url,
  xmppSettings: {
    devServer: backend.dev_server,
    host: backend.host,
    conference: backend.conference,
  },
  jwtLogin: { enabled: true, token: token || '' },
  refreshTokens: { enabled: true },
  initBeforeLoad: true,
};

<XmppProvider config={baseConfig}>
  <Chat
    roomJID={room_jid}
    config={{
      ...baseConfig,
      newArch: true,
      disableInteractions: true,
      disableChatInfo: {
        disableHeader: false,
        disableDescription: true,
        disableType: true,
        disableMembers: true,
        disableChatHeaderMenu: true,
      },
      chatHeaderSettings: {
        hide: false,
        disableCreate: true,
        disableMenu: true,
        hideSearch: singleRoomMode,
      },
      clearStoreBeforeInit: true,
      disableNewChatButton: true,
      disableRoomConfig: true,
      disableProfilesInteractions: true,
      disableRoomMenu: singleRoomMode,
      disableRooms: singleRoomMode,
      enableRoomsRetry: {
        enabled: true,
        helperText: 'Initializing your messages…',
      },
    }}
  />
</XmppProvider>
```

The complete field-by-field reference — every option in `IConfig`, grouped by purpose, plus the single-init contract and a per-room single-chat recipe — lives in **[instructions.md](instructions.md)**. It mirrors the structure of the web package's [`@ethora/chat-component` README](https://www.npmjs.com/package/@ethora/chat-component).

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

## Unread tracking in tab-based hosts

`useUnread()` and the room-list badge are wired to the `<ChatRoom>` mount/unmount lifecycle by default, and **app background/foreground is handled automatically** — backgrounding stamps "read up to now" and clears the open room's "viewed" state (so messages that arrive while you're away count as unread instead of looking already-read); foreground restores it. No wiring needed for that.

What the SDK *can't* see on its own is an in-app **tab/route switch** where the chat screen **stays mounted while hidden** — there the lifecycle never fires and the room looks "always viewed". Signal it one of two ways (don't reach into the store):

**Option A — the `isVisible` prop (simplest):**

```tsx
function ChatTab({ currentTab }: { currentTab: string }) {
  // Library clears/restores the room's unread state from this flag.
  return <Chat config={{...}} isVisible={currentTab === 'chat'} />;
}
```

**Option B — the `useChatRoomFocus` hook** (drive it from a navigator focus signal):

```tsx
import { useIsFocused } from '@react-navigation/native';
import { Chat, useUnread, useChatRoomFocus } from '@ethora/chat-component-rn';

function ChatTab() {
  const isFocused = useIsFocused();
  // Focus marks the room visible (clears the badge in-memory).
  // Blur stamps `Date.now()` so future messages count as unread.
  useChatRoomFocus({
    roomJID: 'general@conference.xmpp.chat.ethora.com',
    isFocused,
  });
  return <Chat roomJID="general@conference.xmpp.chat.ethora.com" config={{...}} />;
}

function TabBar() {
  const { totalCount } = useUnread();
  return <Badge count={totalCount} />;
}
```

(If instead you **unmount** `<Chat>` when it's hidden, you need neither — mount/unmount already handles it.)

Full details (including the cold-start fix and the scroll-to-bottom unread chip) live in [`docs/unread-tracking.md`](docs/unread-tracking.md).

## Logging out

`useLogout()` returns an **awaitable** `() => Promise<void>` that resolves only after the SDK has fully torn down: XMPP disconnect, redux reset, persisted slices wiped, AsyncStorage stray keys removed, REST cache cleared.

```tsx
import { useLogout } from '@ethora/chat-component-rn';

function SignOutButton() {
  const logout = useLogout();
  return (
    <Button
      title="Sign out"
      onPress={async () => {
        await logout();                      // ← awaits the full teardown
        navigation.replace('SignIn');        // disk is provably clean here
      }}
    />
  );
}
```

### Built-in "Sign out" menu item

Don't want to build your own button? Enable the item in the room-list header menu (the drawer with New Chat / Profile / Settings). It renders last, tinted with `config.colors.primary`, and runs the same awaitable teardown as `useLogout()`:

```tsx
<Chat
  config={{
    logout: {
      enabled: true,
      label: 'Sign out',                        // optional; omit for the SDK's own, in the UI language
      confirm: { message: 'Sign out of chat?' }, // `true` (default) uses stock copy (localized), `false` skips the dialog
      onBeforeLogout: async () => {
        // return false to cancel (e.g. unsaved draft guard)
      },
      onAfterLogout: () => navigation.replace('SignIn'), // runs AFTER the full teardown
    },
  }}
/>
```

Tap flow: close drawer → confirmation (native `Alert`) → `await onBeforeLogout?.()` (`false` cancels) → `await logoutService.performLogout()` → `await onAfterLogout?.()`. The host-side session/navigation logout belongs in `onAfterLogout` — by the time it runs, XMPP is disconnected and every persisted key is gone. Errors thrown by either callback are caught and logged via `console.warn`; a throwing `onBeforeLogout` cancels the logout. With `enabled: false` (or the option omitted) the menu is unchanged.

Why awaitable: the persistence layer debounces writes by 200 ms, and the chat slice removes its persisted user fire-and-forget. If the host navigated / re-mounted `<Chat>` immediately after a non-awaited call, the next bootstrap could occasionally rehydrate stale state ("old chats reappear"). Awaiting the returned promise eliminates that race. The function never rejects — any internal failure is logged via `console.warn`, so a non-awaited call still won't crash the host. For non-React contexts you can call `logoutService.performLogout()` directly (same Promise).

## Settings screen

The Settings screen (the gear in the room-list menu) shows Appearance and the push toggle by default, plus Manage data and Visibility. Two more sections are off until the host turns them on:

```ts
config = {
  settings: {
    // "Language": the interface language (user.appLanguage) and the language
    // messages are translated into (user.chatLanguage). Kept on the device and
    // written to the profile (`PUT /v1/users`, one field per request); the
    // profile's values are applied when a session starts.
    languages: { enabled: true, appLanguages: ['en-CA', 'fr-CA'], chatLanguages: ['en-CA', 'fr-CA', 'es-US'] },
    // "Change password": current password, new one twice, `PUT /v2/users/me/password`.
    changePassword: true,
  },
  // Translation is the server's, per the reader's chat language; this shows it.
  translates: { enabled: true, mode: 'auto' },
};
```

The user's interface language wins over `config.i18n.locale`, which stays the default for a user who never chose. `hideAppearance` and `hidePushToggle` hide the built-in cards.

## Customization flags worth knowing

| Flag | What it does |
| --- | --- |
| `disableProfilesInteractions` | Disables entry to the **user-profile popup** — the in-bubble avatar tap on other users' messages. The avatar is still rendered, just non-interactive. (Does **not** affect the chat-title press → use `disableChatInfo.disableChatHeaderMenu` for that.) |
| `disableChatInfo.disableChatHeaderMenu` | Disables the **chat-info modal entry point** in the header (tapping the chat title / icon). Use this when you want the header purely informational. The chat-info modal itself has further granular flags (`disableDescription`, `disableType`, `disableMembers`, `hideMembers`, `disableIconEdit`). |
| `disableChatInfo.disableRoomMenu` | Hides the **three-dots overflow menu on the right of the chat-room header** (the `RoomMenu` with "Leave", etc.). The center panel (avatar + chat name) stays fully visible. **Not** to be confused with the top-level `disableRoomMenu`, which hides the context menu in the **room list**, not the open-chat header. |
| `disableChatInfo.disableIconEdit` | Makes the chat picture read-only — drops "Edit" and "Remove photo" from the chat-profile "…" menu regardless of the user's role. The picture still renders as the screen's hero. |
| `disableChatHeaderBurgerMenuIcon` | Hides the burger icon in the chat header (the icon that opens the room-list dropdown). `chatHeaderBurgerMenu` controls only the dropdown — set this when you want neither rendered. |
| `enableAudio` | Opt-in voice messages. **Off by default.** When `true`, an idle input (no text, no attachments) shows a mic icon in the send-button slot — tap → start recording → stop & send. iOS apps need `NSMicrophoneUsageDescription` in Info.plist (add via `expo-audio`'s plugin block in `app.json`). Receiving voice messages from other clients (incl. legacy web `.bin` voicemails) is **independent of this flag** — incoming audio plays regardless. |
| `disableMemberProfileActions` | Hides the whole "Message / Copy User Id" action block **inside** the chat-info member-profile popup. The popup itself still opens — to block the tap entirely, use `disableChatInfo.disableMemberTap`. |
| `disableChatInfo.disableMemberTap` | Disables the tap on a member row in the chat-info list — the user-profile popup never opens. Set when no per-member interaction is appropriate (e.g. patient-facing apps). |
| `hideMemberSendMessageAction` | Hides only the "Message" button, keeps everything else. |
| `hideMemberCopyIdAction` | Hides only the "Copy User Id" button, keeps everything else. |
| `disableConnectionErrorOverlay` | Replaces the full-screen "Connection error" overlay with a small, non-blocking `ConnectionBanner`. Set this when a transient reconnect shouldn't take over the whole screen. Independently of it, the room list's title and the room header's subtitle read "Connecting…" while the stream is down or being set up and "Updating…" while rooms are re-joined and the archive caught up afterwards (`useChatSettingState().connection`: `'connecting' \| 'syncing' \| 'online' \| 'offline'`). |
| `eventHandlers.onMessageRetry` | `(event) => void` fired when the user taps the "Failed — tap to retry" indicator on a stuck send. Use for telemetry / surfacing a retry banner. |

## Message reactions

Emoji reactions on messages, WhatsApp-style. **On by default**, shared with the web SDK: a reaction set from either client shows up on the other.

- **Long-press a message** → a row of quick reactions appears above the bubble (👍 ❤️ 😂 😮 😢 🙏 by default) together with the Copy / Edit / Delete menu. Tapping an emoji sets it; tapping the same one again removes it.
- **"+"** at the end of the row opens a bottom sheet with the full emoji set: search, "Frequently used" (remembered on the device), categories, and a category bar at the bottom.
- **Under the bubble** every emoji used on the message shows as a chip with its count; the current user's own ones are tinted. Tap a chip to toggle your own reaction; long-press it to see who reacted.
- **In the room list** the preview shows the latest reaction (`Ann: 👍`) when it is the newest event in the room.

```tsx
<Chat
  config={{
    reactions: {
      enabled: true,                       // false → no row, no chips, no picker
      quickReactions: ['+1', 'heart', 'joy', 'open_mouth', 'cry', 'pray'], // up to 8
      picker: true,                        // false → hides the "+" (quick row only)
    },
  }}
/>
```

| Option | Default | What it does |
| --- | --- | --- |
| `reactions.enabled` | `true` | Turns the feature on/off. When off, reactions other users send are still received and stored, just not shown — switching it back on shows them. |
| `reactions.quickReactions` | `['+1','heart','joy','open_mouth','cry','pray']` | Ids shown in the row above the menu, in order (max 8). |
| `reactions.picker` | `true` | Whether the "+" that opens the full emoji picker is shown. |
| `disableReactions` | `false` | Legacy alias of `reactions.enabled: false`. |
| `disableInteractions` | `false` | Disables the whole long-press menu, the reaction row included; existing chips are still shown but no longer toggle. |

**Ids, not glyphs.** Reactions travel on the wire and are stored as emoji *short names* — `+1`, `heart`, `joy`, `fire`, `pray`, … — the same ids the web SDK uses, so both platforms read each other's reactions. The SDK ships its own id→glyph table (~1850 emoji, up to Emoji 14 so every supported OS renders them) and resolves ids when rendering; no emoji library is needed. In `message.reaction` the data is keyed by the reactor's XMPP local part: `{ alice: { emoji: ['joy', '+1'], data: { senderFirstName, senderLastName } } }`.

**Protocol.** One `<message type="groupchat" id="message-reaction:…">` with `<reactions xmlns="urn:xmpp:reactions:0" id="<target stanza id>" from="<reactor jid>">` and one `<reaction>` child per id — always the reactor's **full current list** (an empty `<reactions/>` clears them). Reactions are archived with the room's history and restored with it on every history fetch.

## Replies & threads

Same model as the web SDK, so threads are shared across platforms.

- **Reply** in the long-press menu opens the message's **thread**: the parent on top, its replies below, its own input. It slides in over the room and closes with the back arrow, Android back, or a swipe from the left edge.
- **"Also send to <room>"** under the thread input posts the reply in the channel too. There it shows a **quote** of the parent (author + two lines); tapping the quote opens the parent's thread.
- A message with replies gets a **"N replies" pill** under the bubble with the repliers' avatars; tapping it opens the thread.
- On the wire a reply is a normal message with `isReply="true"`, `showInChannel="true|false"` and `mainMessage` (JSON of the parent: `id`, `text`, `userName`, `roomJid`, …) in its `<data>`. Replies live in the room's history; nothing extra is fetched.

| Option | Default | What it does |
| --- | --- | --- |
| `disableReplies` | `false` | Hides "Reply" in the long-press menu. Existing pills and quotes still open threads. |
| `disableInteractions` | `false` | Hides the whole long-press menu, Reply included. |

## End-to-end encrypted rooms

OMEMO 2 in rooms the backend marks `e2ee` (`room.e2ee` from `GET /v1/chats/my`), wire-compatible with the web SDK. Status, measurements and limits are tracked in [`docs/e2ee-port.md`](docs/e2ee-port.md).

Off by default. The host turns it on or off through the config it passes to the chat:

```ts
// On: this device publishes its keys; text and attachments in `e2ee` rooms are encrypted.
config = { e2ee: { enabled: true } };

// Off (the default): leave the block out, or set `enabled: false`. Nothing is
// generated or published, and encrypted rooms are shown as such but cannot be
// written to from this app.
config = { e2ee: { enabled: false } };
```

The switch can be flipped at any time; it takes effect on the next mount of the chat. Keys made while it was on stay on the device and are reused when it is on again.

**With it on**, after connecting the SDK creates this device's keys (once per account per install; they survive logout), publishes them, and in encrypted rooms:

- encrypts the text of outgoing messages for every device of every member, and decrypts incoming ones — live, from mucsub and from history alike;
- sends in clear when no member has a device to encrypt for (nobody else has opened the room with encryption on yet), exactly as the web SDK does — and marks that message, like any other that arrived in clear, with a struck-through padlock;
- seals attachments and voice messages before upload, so the server stores opaque bytes under a random name and never sees the file, its name or its type; the receiver's "Encrypted file" card downloads and opens one on a tap, and then shows it as what it is. The cipher is pure JS: about 1.4 s per megabyte, capped at 20 MB per file. An attachment is never sent in clear - if it cannot be encrypted, it is not sent.

An encrypted chat is started from a user's profile: **Encrypted message**, next to **Message** (needs `newArch`). It opens the encrypted room of the pair, a room of its own beside their ordinary chat.

What is protected is the message text and the attachments. The sender, the room, the time and the quoted text of a reply stay readable to the server — it builds push notifications from them — and deletions and reactions travel in clear. An edit would too, so a message that went out encrypted cannot be edited from this SDK. Details and the open points are in `docs/e2ee-port.md`.

**Devices and trust.** A person's profile lists their devices with their fingerprints, each marked *Not verified*, *Verified* or *Not trusted*, changed with a tap. A device is trusted on first sight until one of that person's devices has been verified; after that an unverified one is no longer encrypted for.

**With it off** nothing is generated, published or loaded, and an encrypted room is presented honestly rather than misread: the composer is replaced by a notice (`sendMessage` / `sendMedia` refuse the room), and what other clients encrypted shows as a padlock line instead of the sender's fallback body.

**Either way**, a room marked `e2ee` carries a padlock next to its name in the list and the header; a message that could not be opened says why ("Encrypted for another device", "Could not decrypt this message", or that this app does not read encrypted messages); a sealed attachment shows as an "Encrypted file" card rather than a voice message; none of these is offered for translation.

Message flags a custom message component can read: `unencrypted`, `undecryptable` (`'true'` when the body is a placeholder) with `e2eeError` (`'unsupported' | 'other-device' | 'failed'`), `clientEncrypted` (`'true'` for a sealed attachment) and `e2eeKeys`. The captions are the `e2ee.*` and `media.sealed*` keys of `config.i18n.strings`. `omemo()` returns the live device (`devices(jid)`, `setTrust`, `fingerprint`) for a host that wants to show them.

Requires an XMPP server that lets members read each other's OMEMO PEP nodes (`access_model: open`).

## Session loss

When the server rejects the XMPP password (SASL `not-authorized`) the SDK refreshes credentials and reconnects. If that cannot produce a working password — the refresh request fails, returns no new password, or the new one is rejected too — twice in a row, the session is ended exactly like **Sign out** (`performLogout`, then `logout.onAfterLogout`), so the host can route to its login screen. A network outage never triggers this: without a reachable server there is no rejection, and the client keeps reconnecting with backoff.

## Keyboard handling

| Flag | What it does |
| --- | --- |
| `disableKeyboardAvoidingView` | Opts out of the built-in `KeyboardAvoidingView`, so a host app that already wraps `<Chat>` in its own keyboard handling doesn't get a second one avoiding the keyboard on top of it. |
| `keyboardStickyInput` | Wraps only the input dock in a `KeyboardStickyView` instead of avoiding the keyboard for the whole chat tree, so the message list never resizes. Ignored when `disableKeyboardAvoidingView` is set. |
| `keyboardVerticalOffset` | Pass-through offset added on top of the iOS safe-area inset when avoiding the keyboard. |
| `inputDockPaddingBottom` | Bottom padding on the input dock (the composer's outer wrapper). When a number is given (0 allowed), it is used verbatim on both platforms. Left unset, it defaults to `0` when `disableKeyboardAvoidingView` is set, since the host then owns layout and the chat is typically already placed above the host's own chrome (e.g. a tab bar) - the built-in padding would otherwise add an extra gap. Otherwise it is unchanged: the iOS safe-area inset, or a fixed 12dp gap on Android. |

## Header height & font sizing

### Header height (`headerLayout.height`)

The in-chat header and the full-screen modal headers (Chat Profile, Settings, etc.) share **one** height so they line up. Default is `64` px (the bar itself, measured below the status-bar safe-area inset — the notch/Dynamic Island is added on top automatically).

```tsx
<Chat config={{ headerLayout: { height: 72 } }} />
```

`height` acts as a **floor as well as a default**: it can only make the header _taller_. A value at or below `64` (or a non-number) is ignored and the default is used — so a too-small value can't collapse the bar and clip the avatar / back button. Only a value strictly greater than `64` takes effect.

### Per-element font size & weight (`typography`)

Individual labels accept a `{ fontSize?, fontWeight? }` override. Each only sets the fields you provide, so it layers on top of the component default. (With a custom `fontFamily`, `fontWeight` overrides need matching `typography.weightFamilies` entries — RN can't synthesise weights from one font file.)

```tsx
<Chat
  config={{
    typography: {
      headerTitle: { fontSize: 18, fontWeight: '600' }, // room title in the chat header
      profile: {
        screenTitle: { fontSize: 20, fontWeight: '700' }, // chat name in the collapsed profile bar
        title: { fontSize: 24 },                          // chat name over the profile photo hero
        memberName: { fontSize: 16, fontWeight: '600' },
      },
      attachSheet: {
        title: { fontSize: 17, fontWeight: '700' },       // "Photos & Videos" section header
        viewLibrary: { fontSize: 15, fontWeight: '500' }, // the "View Library" link
        rowLabel: { fontSize: 16, fontWeight: '500' },    // row labels ("Upload a File")
      },
    },
  }}
/>
```

See the [`TypographyConfig`](src/types/types.ts) JSDoc for the full list of overridable elements and their defaults.

## Dark theme

Switch the whole component (room list, chat, composer, modals, sheets) to a dark palette with one flag. Colours come from the built-in `DARK_THEME`; any entry can be overridden through `darkColors`, and anything you omit keeps its dark default.

```tsx
<Chat
  config={{
    dark: true,
    // Optional — omit the object entirely to use the default dark palette.
    darkColors: {
      primary: '#7C3AED',
      surface: '#15171B',
      chatBackground: '#0E1013',
    },
  }}
/>
```

Notes:

- In dark mode the light-only knobs (`colors`, `messageColor`, `backgroundChat.color`) are **not** applied — they were tuned for white surfaces. Pass brand colours via `darkColors` instead. `colors.avatar` still applies in both modes.
- `darkColors.primary` also drives `icon`, `senderName` and `dateLabel` unless you set those explicitly, mirroring how `colors.primary` behaves in light mode.
- The full key list (`surface`, `surfaceSecondary`, `text`, `textSecondary`, `border`, `messageBackground`, `messageBackgroundUser`, …) is the `ChatThemeColors` type, exported from the package together with `LIGHT_THEME`, `DARK_THEME`, `resolveTheme(config)` and the `useTheme()` hook, so a host can paint its own chrome (status bar, tab bar) with the same palette.
- The status bar is host-owned: use `resolveTheme(config).statusBarStyle` (`'light-content'` in dark mode) for `<StatusBar barStyle>`.

## Quality & test coverage

### Jest (unit + integration)

```bash
npm test          # ~2s, full suite
```

54 files, 583 tests cover the SDK's substantive surface:

| Layer                          | Coverage |
|--------------------------------|----------|
| Redux slices (rooms, chatSettings, roomHeap) | reducers + slice contracts |
| Middleware (unread, new-message, reactions, logout) | dispatch wiring + edge cases |
| XMPP client                    | constructor, state machine, reconnect backoff, disconnect, QoS / coalesced MAM, delegating helpers |
| XMPP stanza builders (~25 files) | exact wire shape via real `@xmpp/client` `xml()` |
| REST API wrappers              | URL + body + headers + redux side effects, 60s cache, 401 refresh interceptor with queue-during-refresh |
| Persistence                    | AsyncStorage rehydrate, debounced writes, key filtering, room cap |
| Helpers                        | parseMessageBody (markdown render), markdownParser, insertMessageWithDelimiter, createMessageFromXml, ensureScopedChatCache, scheduler, etc. |
| L2 components                  | ChatRoomItem (unread badge), TextInput, DeletedMessage, MessageReply, MessageReaction |
| L3 / e2e (jest)                | `appLoginChatsRn` 3-tab testbed, JWT-login + room mount |

### Maestro (live backend)

```bash
npm run e2e:ios            # boots iPhone 16 sim, runs auth-and-send flow
npm run e2e:android        # ditto Pixel_6
```

Uses any profile in `~/.ethora/profiles.json` (the same file the
`@ethora/setup` CLI writes to). The runner logs the test user via
REST, seeds the testbed's AsyncStorage with the resolved Creds, and
exercises the full pipeline against a real environment:

> REST login → AsyncStorage persisted Creds → app boot →
> `/chats/my` → XMPP WebSocket → MUC presence join → MAM history →
> chat thread rendered with input + send button visible.

If any link in that chain breaks, Maestro fails — making this a
single high-signal smoke for the most-likely class of regressions
(auth flow, XMPP transport, room hydration).

### Live deep test
A generic deep-test runbook for side-by-side iOS ↔ Android validation
lives at `docs/deep-test-chat-runbook.md`. Use it as a reproducible
checklist for your own QA environment.

### Bugs surfaced + fixed (full history on PR #4)
The test pass surfaced a handful of latent bugs that had been
silently shipping. All fixed in the same branch:
- **`apiClient` interceptor**: five separate bugs that combined to
  swallow auth errors and hang the refresh-on-401 path.
- **`unreadMiddleware`**: didn't filter own messages → MAM-replayed
  own messages bumped the unread badge on re-login.
- **`logoutMiddleware`**: filtered on the redux store key instead
  of the slice's action prefix → the XMPP disconnect event never
  fired on logout.
- **`updateMessagesTillLast`**: imported two reducer exports that
  don't exist → any call site crashed at runtime.
- **`historyPreloadScheduler`**: the "skip if already preloaded"
  check was dead — the batch-loading dispatch overwrote the state
  the check read.
- **`TextInput`**: `editable={isLoading}` was inverted vs convention.
- **`MODAL_TYPES`** require cycle (logged on every app boot).

## Local development

This repo doubles as an Expo testbed app: `App.tsx` mounts
`AppLoginChatsRn`, a 3-tab (Setup / Chat / Logs) shell that drives the
SDK end-to-end via either paste-a-JWT or email + app-token login. Run
it against the canonical Ethora Cloud endpoints, your QA/staging
environment, or a self-hosted Ethora instance — all configurable from the Setup tab at
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

This repo uses **npm** (not yarn). `package-lock.json` is the
canonical lockfile and `yarn.lock` is intentionally absent so
`expo run:*` defaults to `npm install` for its post-prebuild
reinstall step. If you prefer yarn for your own work, that's fine —
just don't commit a `yarn.lock` back into the repo.

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

`npm run e2ee:interop` checks the end-to-end encryption against the web SDK's (sessions, mixed rooms, attachments). It needs `ethora-chat-component` checked out next to this repository, or `WEB_SDK=/path`; without it, it skips.

### E2E (Maestro)

`e2e/auth-and-send.yaml` drives the full Setup → Email auth → Chat
tab → enter room → send message → assert it appears flow against a
real backend. Credentials come from any profile in
`~/.ethora/profiles.json` (the file the `@ethora/setup` CLI writes
to), so you don't have to hardcode anything.

Prerequisites:

```bash
# Install Maestro
curl -fsSL https://get.maestro.mobile.dev | bash
export PATH="$PATH:$HOME/.maestro/bin"

# JDK 17+ — Android Studio's bundled JBR works; the runner script
# auto-detects it on macOS so you don't have to set JAVA_HOME.
```

Run against an already-built + installed app + a booted simulator:

```bash
# Uses the first profile from ~/.ethora/profiles.json, room "Main chat"
npm run e2e:ios
npm run e2e:android

# Or pass a different profile / room
scripts/run-e2e.sh ios "Sample Profile" "General"
```

The flow targets stable `testID`s wired into the SDK
(`chat-message-input`, `chat-send-button`, plus `room-<jid-local>`
on each room row) — please keep those identifiers stable for
downstream e2e drivers (Detox, Appium) that rely on the same
contracts.

> Already have your RN environment set up? See the
> [React Native environment setup](https://reactnative.dev/docs/environment-setup)
> doc if any of the above feels unfamiliar.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the list of changes per release.

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
