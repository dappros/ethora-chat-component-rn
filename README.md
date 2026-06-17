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
- [Header height & font sizing](#header-height--font-sizing)
- [Quality & test coverage](#quality--test-coverage)
- [Local development](#local-development)
- [Changelog](CHANGELOG.md)

## What you get

- Room list and room chat UI (Native / iOS + Android)
- Message history (MAM), replies, edits, deletes
- Typing indicators
- Push notifications (FCM / APNs)
- Pluggable auth (default / JWT / injected user / custom)
- Custom message bubble, input, scroll, and day-separator overrides
- Cross-session unread tracking with built-in badges — see [docs/unread-tracking.md](docs/unread-tracking.md)

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
  expo-av expo-video expo-clipboard expo-document-picker \
  expo-image-manipulator expo-image-picker expo-media-library
```

> Video playback uses **`expo-video`** (`useVideoPlayer` / `VideoView`); `expo-av` is still used for audio. Install both.

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

Why awaitable: the persistence layer debounces writes by 200 ms, and the chat slice removes its persisted user fire-and-forget. If the host navigated / re-mounted `<Chat>` immediately after a non-awaited call, the next bootstrap could occasionally rehydrate stale state ("old chats reappear"). Awaiting the returned promise eliminates that race. The function never rejects — any internal failure is logged via `console.warn`, so a non-awaited call still won't crash the host. For non-React contexts you can call `logoutService.performLogout()` directly (same Promise).

## Customization flags worth knowing

| Flag | What it does |
| --- | --- |
| `disableProfilesInteractions` | Disables entry to the **user-profile popup** — the in-bubble avatar tap on other users' messages. The avatar is still rendered, just non-interactive. (Does **not** affect the chat-title press → use `disableChatInfo.disableChatHeaderMenu` for that.) |
| `disableChatInfo.disableChatHeaderMenu` | Disables the **chat-info modal entry point** in the header (tapping the chat title / icon). Use this when you want the header purely informational. The chat-info modal itself has further granular flags (`disableDescription`, `disableType`, `disableMembers`, `hideMembers`, `disableIconEdit`). |
| `disableChatInfo.disableRoomMenu` | Hides the **three-dots overflow menu on the right of the chat-room header** (the `RoomMenu` with "Leave", etc.). The center panel (avatar + chat name) stays fully visible. **Not** to be confused with the top-level `disableRoomMenu`, which hides the context menu in the **room list**, not the open-chat header. |
| `disableChatInfo.disableIconEdit` | Makes the chat icon read-only in the chat-info modal — hides the press-to-pick picker AND the remove affordance regardless of the user's role. The icon still renders. |
| `disableChatHeaderBurgerMenuIcon` | Hides the burger icon in the chat header (the icon that opens the room-list dropdown). `chatHeaderBurgerMenu` controls only the dropdown — set this when you want neither rendered. |
| `enableAudio` | Opt-in voice messages. **Off by default.** When `true`, an idle input (no text, no attachments) shows a mic icon in the send-button slot — tap → start recording → stop & send. iOS apps need `NSMicrophoneUsageDescription` in Info.plist (add via `expo-av`'s plugin block in `app.json`). Receiving voice messages from other clients (incl. legacy web `.bin` voicemails) is **independent of this flag** — incoming audio plays regardless. |
| `disableMemberProfileActions` | Hides the whole "Message / Copy User Id" action block **inside** the chat-info member-profile popup. The popup itself still opens — to block the tap entirely, use `disableChatInfo.disableMemberTap`. |
| `disableChatInfo.disableMemberTap` | Disables the tap on a member row in the chat-info list — the user-profile popup never opens. Set when no per-member interaction is appropriate (e.g. patient-facing apps). |
| `hideMemberSendMessageAction` | Hides only the "Message" button, keeps everything else. |
| `hideMemberCopyIdAction` | Hides only the "Copy User Id" button, keeps everything else. |
| `disableConnectionErrorOverlay` | Replaces the full-screen "Connection error" overlay with a small, non-blocking `ConnectionBanner`. Set this when a transient reconnect shouldn't take over the whole screen. |
| `eventHandlers.onMessageRetry` | `(event) => void` fired when the user taps the "Failed — tap to retry" indicator on a stuck send. Use for telemetry / surfacing a retry banner. |

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
        screenTitle: { fontSize: 20, fontWeight: '700' }, // "Chat Profile" title in the modal header bar
        title: { fontSize: 24 },                          // big room-name title on the profile screen
        memberName: { fontSize: 16, fontWeight: '600' },
      },
      attachSheet: {
        title: { fontSize: 13, fontWeight: '600' },       // "Attach" header label
        rowLabel: { fontSize: 16, fontWeight: '500' },    // row labels (Take photo / Photo or video / Document)
        rowHint: { fontSize: 13 },                        // the small grey subtitle under each row
        cancelButton: { fontSize: 16, fontWeight: '600' },
      },
    },
  }}
/>
```

See the [`TypographyConfig`](src/types/types.ts) JSDoc for the full list of overridable elements and their defaults.

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
