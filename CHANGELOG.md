# Changelog

All notable changes to `@ethora/chat-component-rn` are listed here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project doesn't follow strict semver yet — version corresponds to the `package.json` field.

## [Unreleased]

The repo itself now lives on **Expo SDK 57 (RN 0.86.2, React 19.2.8, New Architecture)** — until now the SDK was only *compatible* with 57 (peer ranges verified in 26.6.3) while developing and testing against 54. Published peer ranges are unchanged, so SDK 54 consumers are unaffected; both lines are now proven by the CI consumer-smoke matrix.

### Changed

- **Dev/test toolchain moved SDK 54 → 57**: `expo ~57`, `react-native 0.86.2`, `react 19.2.8`, `jest-expo ~57`, all `expo-*` dev pins to `57.x`, `reanimated ~4.5`, `worklets ~0.10`, `gesture-handler ~2.32`, `screens ~4.26`, `safe-area-context ~5.7`, `svg 15.15.4`, `netinfo 12`. LiveKit dev pins moved to the RN 0.86 line: `@livekit/react-native 2.12.0`, `@livekit/react-native-webrtc 144.1.2`, `livekit-client 2.21.0`.
- **iOS `deploymentTarget` 15.1 → 16.4** in `app.json` — the minimum `expo-modules-core@57` accepts.
- **`StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill`** across 9 files: RN 0.86 removed `absoluteFillObject` entirely; `absoluteFill` is the same plain object on every RN version our peer range spans, so spreads keep working for SDK 54 consumers.
- **`VideoView`'s `allowsFullscreen` prop dropped** in `FilePreviewModal`: expo-video 57 renamed it to `fullscreenOptions.enable`. Both old and new props default to fullscreen-enabled, so passing neither keeps the file compiling against both expo-video lines with identical behaviour.
- **CI switched from yarn to npm** (`npm ci`): `yarn.lock` was deliberately deleted long ago, which left the yarn-based workflow unable to run at all. **Consumer-smoke is now a matrix** — the packed tarball is installed and type-checked against both an SDK 54 (RN 0.81) and an SDK 57 (RN 0.86) consumer fixture.
- **`react-native-keyboard-controller` `^1.18.5` → `^1.22.3`**: 1.18's Kotlin does not compile against RN 0.86 (`:react-native-keyboard-controller:compileDebugKotlin` fails), 1.22.3 builds cleanly on both lines.

### Fixed

- **Secure media rendered blank ("files send but don't render").** Files uploaded through `/v2/files/secure` are served membership-gated and need the viewer's personal `?ft=<fileToken>`; the token was routinely missing from the store, so every image/video bubble 401-ed into a blank box. Three holes closed:
  - **Priority-1 `userLogin.user` now adopts the fresher persisted session.** A host's `userLogin.user` is a snapshot captured at the host's login time and re-presented on every mount, while the SDK keeps rotating the session and persisting the newest pair (with fileToken) to `ETHORA_USER`. The resolver used to take the snapshot verbatim, discarding the live session; now, for the same account only, whichever refresh pair was minted later wins (JWT `iat` decides, so a genuine host re-login still takes precedence), and a missing fileToken is backfilled either way.
  - **Bootstrap rotates BEFORE the first XMPP connect** (`initBeforeLoad`, refresh enabled, non-jwt modes). On the rotating backend the xmpp password is a short-lived JWT that only the newest rotation knows, so a snapshot's password is usually already dead at boot: SASL failed `not-authorized`, all three bootstrap retries re-presented the same dead password, and the user dead-ended on the Connection error modal. The pre-connect rotation gets a live xmpp password for the first SASL attempt and lands the fileToken before the first media render.
  - **Testbed dropped the fileToken on email login.** `/users/login-with-email` returns it at the TOP level of the response, next to token/refreshToken, not inside `user`; the harness now folds it into the resolved user, and its chat remount key includes the token tail so "Test connection" + "Save & use" actually swaps in the new session instead of keeping the old one until an app restart.
- **`/v2/files/secure` -> `/v1/files/` fallback implemented** (it was specified by the `uploadFile.fallback` suite but never written, leaving 4 tests red): a 404 means the backend doesn't serve the secure route, so the upload retries on `/v1/files/` without `chatName` and latches legacy for the session; a no-response network error retries once without latching; real HTTP errors (401/403/413/500) still surface to the caller unchanged. Avatar/icon uploads keep going straight to `/v1/files/` and cannot latch the secure route off.
- **Video play badge could vanish on Android (Pixel, Android 16, New Arch) for messages without a poster.** The no-poster fallback mounted a live expo-video `VideoView` just to paint a first frame, and on New Architecture the native video surface composites above sibling RN views — hiding the play badge so the video looked like a photo (`surfaceType="textureView"` does not prevent this). The inline bubble no longer mounts any video surface: the no-poster branch renders a static dark placeholder behind the badge, which plain RN views cannot occlude, and behaves identically on SDK 54 and 57. Playback (and the real first frame) stays in the full-screen preview modal; long lists also stop paying for a muted player instance per video row.
- **Android speaker toggle in calls was a silent no-op.** `toggleSpeaker` called `AudioSession.setAndroidAudioConfiguration?.()` — a method that has never existed on any `@livekit/react-native` version, so the optional call quietly did nothing: the icon toggled while audio stayed on the earpiece. Replaced with `AudioSession.selectAudioOutput('speaker' | 'earpiece')` (present on 2.7.6 through 2.12), without `?.` so a real failure hits the `catch` and rolls the icon back. Pre-existing bug, not an SDK 57 regression.
- **`messageListNewMessages` suite died on expo 57's lazy `fetch` global.** The suite fully mocks `react-native` without `Platform`; expo 57's winter runtime requires `expo-modules-core` on first `fetch` touch, which reads `Platform.select` at import time. The mock now provides `Platform`.

## [26.6.3]

Three releases' worth of work landing together: **audio/video calling**, a **translation architecture** mirroring the web SDK, and the **`expo-av` → `expo-audio`** migration that unblocks Expo SDK 57. Alongside them, four delivery bugs that all presented as "messages just stop arriving", and a persistence fix that was writing megabytes of member roster on every debounce tick. Verified with typecheck clean and 644 jest tests green, plus live on-device runs against a real QA backend for calls, translation and voice messages.

### Added

#### Audio and video calls (opt-in via `config.videoCalls`)

- **Call state machine and XMPP signalling ported from web**, behaviour unchanged: `callSlice` (phase/direction/kind, with `connectedAt` anchored once so a mid-call reconnect blip cannot shrink the logged duration), `call-token` / `call-invite` / `call-state` stanza handling, and the kind-hint stash that works around the backend dropping `kind` on its broadcast token.
- **Call UI built on `livekit-client`'s imperative Room API.** The web session uses `@livekit/components-react`, which assumes a DOM; here the Room is driven directly and derived state (subscribed tracks, mute flags, connection state) is re-synced on `RoomEvent`. Only the video surface comes from `@livekit/react-native`.
- **Both LiveKit packages and `react-native-callkeep` are OPTIONAL peer dependencies**, required lazily through `livekitRuntime.ts` / `useCallKeep.ts`. A top-level import would break the bundle for every chat-only host over a feature they never switched on. Hosts without them get a clear "calls unavailable" message, not a redbox.
- **Push is the primary path for incoming calls, not a fallback.** On mobile the XMPP socket dies whenever the OS backgrounds the app, taking the call-token stanza with it. `handleCallPush` claims anything call-shaped before the chat-notification path so a call can never surface as an "OK / Open" alert, and reports back even when it decides not to ring (calls disabled, already ringing this call, no token to accept with).
- **Call-state stanzas render as call-log entries** ("Outgoing call, 12 sec"). Control frames are dropped at the reducer boundary so they never appear as "Deleted User: call-state" bubbles, and the local hangup fallback dedupes against the server copy by `callId`.

#### Translation / i18n

- **Static UI captions and per-message translation are now two separate mechanisms**, matching web. Static captions come from a built-in flat string table per language (en, fr, es, pt, ht, zh) with no external i18n dependency, overridable per key via `config.i18n.strings`.
- **`useT` resolves the locale from `config.i18n.locale`, falling back to the reader's `langSource`**, so picking a language in the chat switches the interface and the message translations together. A reader who picks Français expects the whole chat in French, not French messages inside an English UI.
- **Auto-translate is the default rendering.** The translation is the message body with the original quoted above it (`TranslatedMessageBody` + `useMessageTranslation`, ported from web). The reader's own messages are never translated.

### Breaking

- **`expo-av` is replaced by `expo-audio` in `peerDependencies`.** Consumers using voice messages must install `expo-audio` and may drop `expo-av`:

  ```bash
  npx expo install expo-audio
  npm uninstall expo-av
  ```

  Apps that set the microphone permission through `expo-av`'s config-plugin block in `app.json` must move it to `expo-audio` (same `microphonePermission` option). No change is needed to `IConfig` or any component prop — `enableAudio` and the message surfaces are unchanged.

### Changed

- **Voice messages moved off the discontinued `expo-av` and onto `expo-audio`**, which is what unblocks consumers upgrading to **Expo SDK 57 (RN 0.86, React 19.2, New Architecture)**. `expo-video` already handled video, so audio was the last `expo-av` surface in the SDK.
- **`AudioMessage` plays through `createAudioPlayer`** instead of `Audio.Sound.createAsync`. The WebView Opus→WAV decoder path for iOS WebM/Ogg is untouched; only the native playback engine underneath it changed.
- **`SendInput` records through `useAudioRecorder`** instead of a per-take `Audio.Recording`. Each take still prepares with `RecordingPresets.HIGH_QUALITY`, which allocates a fresh output file so a second voice message cannot overwrite one whose upload is still in flight.
- **Peer ranges verified against Expo SDK 57.** Every existing range already accepts the SDK 57 versions (`react@19.2`, `react-native@0.86`, `expo-*@57.x`), so no other peer needed widening. `expo-audio` is declared as `>=1.0.0`, which spans both SDK 54 (`1.x`) and SDK 57 (`57.x`), and every call site type-checks against `expo-audio@57`.
- **LiveKit native deps pinned exactly in `devDependencies`** (`@livekit/react-native` 2.7.6, `@livekit/react-native-webrtc` 125.0.11, `livekit-client` 2.9.0, `react-native-callkeep` 4.3.16). The `^` ranges resolved `@livekit/react-native@2.12`, which peer-requires webrtc `^144` and conflicts with the 125.x line. The published peer ranges stay flexible and optional.

### Fixed

#### Message delivery — four separate causes of "new messages just stop arriving"

- **The mucsub event envelope was never unwrapped.** Every room is mucsub-subscribed, so ejabberd delivers live room traffic wrapped in a pubsub `<event><items><item><message>` envelope. `handleStanza` read `<data>` / `<body>` off the OUTER envelope, found nothing, and dropped every live message — they only reappeared later through MAM history or an app restart.
- **Messages whose `<data>` carries no `senderJID` were dropped.** A real wire capture from the shared QA server showed the web SDK's translate-tagged send path builds `<data>` from a completely different attribute bag (`roomJID`, `firstName`, `userMessage`, no `senderJID` at all). Both `onRealtimeMessage` and `onMessageHistory` hard-required `senderJID`; they now fall back to the stanza's `from`, matching web's leniency.
- **Reconnect could wedge permanently.** `reconnect()` awaited the old client's `stop()` unbounded, and on the half-dead socket we are reconnecting *for*, `@xmpp/client`'s `stop()` can hang forever on a close handshake that never lands. The single-flight `reconnecting` flag stayed `true`, so every later trigger (watchdog, NetInfo, AppState) short-circuited and the client never came back until the app was killed. Teardown is now bounded by `withTimeout()`.
- **The foreground watchdog was gated too tightly.** It skipped whenever `AppState.currentState !== 'active'`, but iOS reports `'inactive'` for many transient non-backgrounded states (Control Center, app switcher, an unfocused Simulator window), silently disabling it. It now only skips on a genuine `'background'`.

#### Identity, avatars and the send path

- **Sender identity resolves through `usersSet`, not the message.** `Message.tsx` read `message.user.name` / `message.user.profileImage` directly — a snapshot of whoever sent the message whenever they sent it — while `usersSet` is the store that keeps updating. `usersSet` itself was never populated anywhere in the RN codebase despite being read; it is now hydrated from the `/chats/my` members payload. The avatar case was a correctness bug and not just a staleness one: once the persist layer stopped caching per-message avatars, a cache-restored message carried no `profileImage` at all and rendered a blank initials circle.
- **Translate-tagged sends no longer stick on "pending".** The builder produced a malformed `<data>` element (no `xmlns`, wrong attribute names) that the server silently dropped, so no echo ever came back. It is now built identically to `sendTextMessage`, plus the `<translate source>` tag.
- **Hardcoded UI strings now go through `t()`** in `SendInput`, `RoomList` and `UsersList` — the keys already existed in all six languages but the components used raw literals.

#### Push

- **Devices are no longer registered against the development environment.** `push.api.ts` hardcoded `push.ethoradev.com` and qualified every JID with `@xmpp.ethoradev.com` — shipped inside the SDK, so every host app including production ones registered against dev infrastructure and then quietly received no pushes. Both now resolve from the host's own config with the production cluster as fallback, and an already-qualified JID is no longer double-qualified. Also drops a `console.log` that printed the whole subscription payload, FCM token included, on every subscribe.

#### Calls

- **A camera or mic failure no longer kills the whole call.** `VideoCallSession` shared one try/catch across `room.connect()` and `setMicrophoneEnabled()` / `setCameraEnabled()`, so any device failure — permission denied, or simply no camera hardware, which is every iOS Simulator — was treated as a fatal connect failure. From the ring screen this read as "tapped Accept, nothing happens". Only `room.connect()` is fatal now; device failures surface as a dismissible hint while the call proceeds, matching web.
- **`createChatCall` is bounded by a 15s timeout.** Reproduced live: the request hung for 75+ seconds through the iOS Simulator's network stack, while the identical request via `curl` returned in 0.65s. Neither SDK set a timeout anywhere on its axios client, so nothing bounded the wait and the UI's separate 30s ring timeout was uncoordinated with it.
- **`react-native-callkeep` is genuinely optional.** `loadCallKeep()` now probes `NativeModules.RNCallKeep` before requiring the package, so a build where the JS package is present but the native side is not linked no longer crashes in `new NativeEventEmitter(null)`.

#### Voice message playback (from the `expo-av` → `expo-audio` migration)

- **Playback times are converted from seconds to milliseconds at the status boundary.** `expo-audio` reports `currentTime` / `duration` in seconds where `expo-av` used milliseconds; passing them through unconverted would render every voice message as `0:00 / 0:00` with a dead progress bar and no error.
- **Pause/resume works.** `expo-audio`'s `play()` and `pause()` emit no status event of their own (`playAsync` / `pauseAsync` resolved with one), and the periodic time observer that reports `playing` stops while paused — so the playing flag is now set locally at the tap. Caught on-device: without it the button latched on "pause" after the first tap and the clip could never be paused or resumed.
- **Native audio players are explicitly released.** `expo-audio` players are native shared objects that are not collected with the component, so they are `remove()`d (with their status subscription) on unmount and whenever `src` changes.

### Performance

- **Member rosters no longer crowd out the message cache.** `sanitizeRooms` spread the whole room object into AsyncStorage, roster included. Measured against a real account, one room serialized to 839,228 chars of which 838,473 were its 3,478 members — roughly 750x the rest of the room object combined, rewritten on every debounce tick, for data that `/chats/my` refetches on the very next load anyway. On Android that meant blown AsyncStorage cursor-window limits and multi-second writes. Members are now dropped before writing, preserving `usersCnt`.

### Internal

- **`__tests__/expoAudioMigration.test.tsx`** renders both audio components against a fake `expo-audio` and pins each silent-failure mode: the seconds→milliseconds conversion, the now-required explicit `play()`, pause/resume without a status event, the renamed audio-mode keys (`playsInSilentMode` / `allowsRecording`), player release on unmount, and the record → stop → upload → restore-audio-mode sequence. Every one was confirmed to fail the suite when the fix is reverted.
- **19 call tests** over the parts that carry real risk and need no native modules: push payloads that must and must not be read as calls, the reducer guards (stale token for another room, accept on a non-incoming call, `connectedAt` anchoring, `kind` patched after the token wins the race), call-log direction and dedupe, and the translate-mode policy.
- **XMPP regression tests** pinning the exact captured wire formats: the mucsub envelope, a plain non-mucsub message passing through untouched, and `<data>` with no `senderJID` on both the realtime and history paths.

## [26.5.11]

Single-room and host-app hardening on top of 26.5.10: unread state no longer overloads `lastViewedTimestamp`, room JIDs are normalized before XMPP join paths, iOS keyboard spacing is normalized across devices, tracked default credentials are removed from source, and tenant-specific docs/testbed defaults are scrubbed. Verified with targeted Jest regression suites plus `npm run build`.

### Changed

#### Unread / single-room lifecycle

- **Unread state split into persisted vs ephemeral visibility.** The store now tracks room visibility separately (`visibleRoomJID`) instead of overloading `lastViewedTimestamp = 0` as an "active room" sentinel. This removes the main source of tab-mounted single-room unread regressions and makes cold-start / blur / background semantics consistent.
- **Canonical private-store flush path.** Blur, unmount, background, and logout paths now converge on the same unread timestamp flush flow instead of mixing local state updates with special-case stanza writes.
- **Delimiter logic no longer depends on sentinel `0`.** "New messages" UI now derives from real timestamps / visibility instead of a magic unread value, which keeps divider behavior stable in mounted-tab hosts.

#### Single-room roomJID normalization

- **Bare room ids are normalized to full MUC JIDs** before single-room join/info/member/archive calls. This aligns the join path with the existing history path and prevents reconnect/join failures when a host passes only the room local-part.

#### iOS keyboard layout

- **Keyboard spacing normalized across iOS devices.** Chat input safe-area compensation is now centralized so devices with and without a home indicator keep the same visual dock behavior when the keyboard opens.
- **`SafeAreaProvider` wrapped by the RN testbed shell.** The shared wrapper now guarantees `useSafeAreaInsets()` has a provider in the local app path.

#### Credentials / docs hygiene

- **Tracked default credentials removed.** `AppLoginChatsRn` now ships with blank setup defaults; the JWT seed helper reads from an ignored local JSON file instead of secrets in tracked source.
- **Tenant-specific docs and QA notes replaced with generic runbooks.** Example profile names, QA hostnames, and customer-specific notes were scrubbed from README / scripts / docs in favor of reusable environment-agnostic instructions.

### Fixed

- **Tab-mounted single-room unread regressions.** Focus/blur/background behavior now works without importing internal store paths from consumer apps.
- **Cold-start unread marker clobbering.** Persisted last-viewed state is no longer vulnerable to being overwritten by the old active-room sentinel flow.
- **Single-room reconnect/join mismatch for bare room ids.** XMPP room operations now operate on normalized MUC JIDs consistently.

### Internal

- **Repo-side pre-commit typecheck hook is versioned and wired.** `.githooks/pre-commit` runs `tsc --noEmit --moduleResolution bundler --module esnext -p tsconfig.json`, and `scripts/install-git-hooks.js` sets `git config core.hooksPath .githooks` from the `prepare` script. Use `ETHORA_SKIP_TYPECHECK=1` or `git commit --no-verify` only when intentionally bypassing it.

## [26.5.10]

Lifecycle hardening on top of 26.5.9, driven by live on-device testing: a full reconnect-after-loss overhaul (a live test surfaced — and this release fixes — a reconnect storm), cache no longer wiped on re-entry, automatic AppState-driven unread visibility plus a new `isVisible` prop for tab hosts, `initBeforeLoad` auto-retry, and the "New messages" divider polish. Full regression sweep — typecheck clean, 584 jest tests green.

### Fixed

#### Packaging / TypeScript (regression from 26.5.5)

- **#8 — consumers' tsc no longer compiles our raw source.** `exports['.'].react-native` pointed at `./src/main.ts`, so React Native consumers' TypeScript (which resolves with `customConditions: ["react-native"]`) walked our entire `src/` tree and hit 51 errors about our internal devDeps (`@types/ltx`, `@types/uuid`, `@types/xmpp__client`, JSX namespace) — blocking pre-commit hooks on consumer side. The condition is now a nested entry that exposes the **compiled** artifacts: `react-native.types → ./lib/typescript/main.d.ts`, `react-native.default → ./lib/module/main.js`. No `src/*.ts` is reachable through any `exports` chain. (Verified by parsing the resolution graph and confirming zero `./src/` references in `exports`.)
- **Pre-commit typecheck hook (repo-side).** Added `.githooks/pre-commit` that runs `tsc --noEmit` with the project's `--moduleResolution bundler --module esnext` flags before every commit; a `scripts/install-git-hooks.js` wires `core.hooksPath` from the `prepare` script on `npm install`. Zero runtime deps. Bypass with `ETHORA_SKIP_TYPECHECK=1` or `git commit --no-verify` if you really need to. Catches future packaging-style regressions before they ship.

#### Connectivity / reconnect (the big one)

- **Never permanently gives up.** `scheduleReconnect` used to hard-stop at `maxReconnectAttempts` (5) — ~62s, after which only a NetInfo/foreground event could revive the client. It now retries indefinitely while mounted, with the exponential backoff **clamped to `maxReconnectDelay` (30s)**.
- **Connect-time failures retry.** A failed `client.start()` lands in `status: 'error'`, which previously had no retry path (only a drop *after* being online did). It now schedules a backoff reconnect (refreshing creds first on a SASL `not-authorized`).
- **Reconnect storm fixed (found by the live bad-host test: 397 schedule calls / 0 actual reconnects / 3 orphan clients).** Three causes addressed: (a) the `initBeforeLoad` auto-retry no longer leaves orphan `XmppClient` instances — `initializeClient` closes the prior global client before creating a new one; (b) `scheduleReconnect` now coalesces — a burst of `disconnect` events no longer re-arms the timer faster than it can fire (which starved `reconnect()` and spammed the counter); (c) **`@xmpp/client`'s built-in reconnect is disabled** so this SDK is the single reconnect driver (no dual-layer ~1s socket storm against a dead host).
- **`forceReconnect` debounced (2s)** so NetInfo + AppState + the new watchdog firing together can't spawn a storm.
- **New foreground watchdog.** While the app is active, a 30s timer forces a reconnect when the client isn't online and reconnect isn't suppressed — covering a stuck `connecting`/`error` and server-side outages NetInfo never reports. Replaces the old provider reconnect effect, which keyed on `client.status` (a mutated class field React doesn't track) and so frequently never re-ran.
- **NetInfo reconnect loosened.** Forces a reconnect on any "reachable while offline/error", not only after a prior offline→online transition — a missed/coalesced offline event no longer strands the client.

#### initBeforeLoad

- **Auto-retries a transient bootstrap failure** up to 3× with backoff before surfacing the error modal (a flaky network at launch self-heals; auth/credential failures still fail fast).
- **Overall 45s time budget** — a hung step can no longer strand the loader in `running` forever.
- **Private store re-synced on reconnect** (not just MUC re-join), so unread / `lastViewedTimestamp` stays accurate after a long reconnect.

#### Unread tracking

- **Re-entry no longer wipes the cache.** History is now **merged by message id** (the microsecond-resolution stanza id) instead of replaced — older cached messages and the unread derived from them survive; only a true gap (the fetched page shares no id with the cache) clears that one chat's cache. `addRoom` also preserves cached messages + unread when the `/chats/my` refetch omits them (it sends `messages: []`).
- **AppState now drives room visibility automatically** (library-level). Backgrounding stamps `lastViewedTimestamp = now` and clears the open room's "visible" state — so messages arriving while away count as unread instead of being silently marked read; foreground restores it. No consumer wiring required.
- **New `<Chat isVisible={…} />` prop.** For hosts that keep `<Chat>` **mounted while hidden** (tab/route navigators), pass `isVisible={currentTab === 'chat'}` — the library clears/restores room visibility from it internally, so consumers never reach into the store. Complements `useChatRoomFocus`.

#### "New messages" divider

- **White text.** The label sits on a dark pill but rendered in the (often blue) primary color — unreadable. It's now white.
- **Removed when you leave the chat** (tab switch / navigation / app background) and **spliced out rather than tombstoned**, so it correctly re-appears for the next batch of unread — previously it was a one-shot (the tombstone blocked every future divider).

#### Voice messages (new — opt-in, matches the web UX)

- **Tap-to-record voice messages from the input bar.** Behind a new opt-in `config.enableAudio: true` (default off — set `true` to enable). The right-side action button swaps between **mic** (when input is empty) and **send** (when there's text or attachments) — same single-button pattern as the web app. Tap the mic → recording overlay with a live timer + cancel + stop&send. Recording uses `expo-av`'s `Audio.Recording` (HIGH_QUALITY preset: AAC in an M4A container on both iOS and Android), and on stop ships through the same `sendMedia` pipeline with `mimetype: "audio/m4a"` and `filename: "voice-<timestamp>.m4a"`. Receivers route it through `MediaMessage`'s audio branch directly.
- **Incoming audio always plays** — independent of `enableAudio`. The 26.5.10 `isLikelyAudio` heuristic still catches octet-stream voicemails coming from older web senders.
- **iOS apps need `NSMicrophoneUsageDescription`** in `Info.plist`. The bundled `expo-av` plugin block in `app.json` adds it on `expo prebuild`; standalone apps should configure it the same way.

#### Customer-reported bugs (this round)

- **#19 — `useUnread()` always 0 in tab-mounted hosts.** `ChatRoom`'s visibility effect had `client` in its dep array, so any `client` identity change (reconnect, provider re-render) re-fired setup → `dispatch(setVisibleRoom(activeRoomJID))` ~one tick after the host cleared visibility via the `isVisible` prop on `<Chat>`, clobbering it. Effect now splits setup (deps without `client`) from cleanup (reads client through a ref). `<Chat isVisible={...} />` now works as documented.
- **#15 — `disableChatHeaderBurgerMenuIcon` clipped the chat avatar/name.** When the burger was hidden the header still reserved an empty `leftContainer` at `width: 15%`, eating space and clipping the title. The placeholder is no longer rendered — `CenterContainer` expands to fill, the chat-name row now sits flush with the left edge as intended.
- **#16 — new `disableChatInfo.disableMemberTap` flag.** `disableMemberProfileActions` only hides the *action block inside* the member-profile popup; the popup itself still opened on tap. The new flag blocks the tap entirely, so the popup never opens. Both flags can be combined for full lock-down.
- **#9 (video) — video preview tap unresponsive.** `VideoMessage` wrapped a `VideoView` in a `TouchableOpacity` with `pointerEvents="none"` on the inner view — on some `expo-video` versions / iOS the native VideoView still intercepted gestures, so tapping the poster did nothing. Switched to a capture-overlay pattern: VideoView at the bottom, transparent `Pressable` absolute-filled on top owns the tap → `setActiveModal(FILE_PREVIEW)` reliably fires. (The .bin voicemail case is a web-app issue — see migration note below.)
- **#23 — phantom "ethora.com" room stub.** `rooms.api` synthesized JIDs as `<name>@conference.xmpp.chat.ethora.com` when the REST item carried no JID and the consumer hadn't configured `xmppSettings.host` — surfacing a fake "ethora" room on third-party servers. Removed the hardcoded vendor host; the fallback now derives the host from `config.baseUrl` (`api.foo.com` → `xmpp.foo.com`), and if that's still ambiguous the room is skipped with a `warn` log rather than fabricated.

**Migration notes for consumers**

- *#9 voicemail .bin*: the testbed sees voicemails from the web app arrive with `mimetype: application/octet-stream` and no audio file extension, so the audio-extension sniff in `MediaMessage.tsx` doesn't match and the file falls through to `FileDownload` (unplayable). Fix on the **web sender side**: when uploading a voice message, set `mimetype: audio/mp3` (or `audio/m4a` / whatever the actual codec is) and ensure the filename ends in a recognised audio extension (`.mp3` / `.m4a` / `.wav` / `.aac` / `.ogg` / `.flac`). The RN side then plays it correctly without further changes.
- *#16 migration*: if you previously set `disableMemberProfileActions: true` expecting it to also suppress the tap, set `disableChatInfo.disableMemberTap: true` additionally.

#### Misc

- **Modal header layout fixed.** `HeaderContainer` had `padding-top: 62px` (status-bar offset) clamped under `min-height/max-height: 24px`, so content overflowed the visible header band — the back arrow visibly hugged the bottom of the white header strip instead of being vertically centered. Dropped the height clamps and switched to symmetric vertical padding (`12px` + `56px` top inset). Fixes every modal that uses `ModalHeaderComponent` (chat-profile, user-profile, settings, file-preview, …).
- **New `disableChatInfo.disableIconEdit` flag.** Hides the press-to-pick / remove affordances on the chat icon in the chat-info modal regardless of the user's role, so consumers can make a branded / read-only room icon. The icon itself still renders.
- **Profile-vs-chat-info flag split (semantic fix).** `disableProfilesInteractions` is now correctly scoped to **user-profile** popups only — wired in `Message.tsx` for the in-bubble avatar tap (where it was missing) and removed from `ChatHeader`'s chat-title press (where it had the wrong semantic — that surface opens the *chat-info* modal). The header tap is now gated by the already-existing-but-previously-unwired `disableChatInfo.disableChatHeaderMenu`, so a consumer can disable user profiles without losing chat info — and vice versa. Migration note for anyone relying on the old behaviour: if you set `disableProfilesInteractions: true` to suppress the header tap, also set `disableChatInfo.disableChatHeaderMenu: true`.
- **`useLogout()` now returns an awaitable `() => Promise<void>`.** Previously the hook fired-and-forgot `logoutService.performLogout()`, so a host that navigated immediately after `logout()` could race the persistence middleware's 200 ms debounce and rehydrate stale state on the next mount ("old chats reappear"). The returned promise resolves after XMPP disconnect + persisted slices wiped + REST/AsyncStorage cleared; it never rejects. **Type-level change** (`() => void` → `() => Promise<void>`) — non-awaiting callers continue to work, but you can now `await logout()` before navigating.
- **Benign unhandled-rejection red box gone.** The dev rejection tracker now reports only *genuinely* unhandled rejections (`allRejections: false`), and `createTimeoutPromise` self-observes its timeout so a settled `Promise.race` no longer leaks a `reject(undefined)`.
- **Input bar spacing.** The send button's horizontal margin is removed so its gap from the input matches the attach button's.

### Tests / internal

- Testbed harness (`AppLoginChatsRn`): opens on the **Setup** tab by default; runtime credentials moved to a **gitignored** local file (no secrets in tracked source — `DEFAULT_CREDS` is blank, `seed-jwt-creds.example.json` carries placeholders); LogBox dev-noise filtered via `setupLogBox`; a `METRO_NO_WATCHMAN=1` escape hatch in `metro.config.js` for flaky watchman.
- New regression tests: reconnect coalesce + `forceReconnect` debounce + uncapped/clamped backoff, history merge / gap-clear / no-wipe, `addRoom` preservation, and the divider splice. Full sweep — typecheck clean, **583 jest tests** green.

## [26.5.9]

Hardening round on top of 26.5.8: the critical reconnect/MUC delivery bug, unread-tracking gaps in tab navigators, a stale-JWT idle loop, translated-message reconciliation, and the `expo-av → expo-video` migration for video playback. Full regression sweep — typecheck clean, 554 jest tests green.

### Fixed

#### Connectivity (the critical one)

- **Bug #21 — reconnect didn't re-join MUC rooms (local double-tick, never delivered).** On a new stream after an extended drop the client was no longer joined to any room, so sends got a local double-tick but never reached the other end. `XmppClient` now fires an `onOnline` callback that the provider wires to `allRoomPresences(...)` — every room's presence is re-sent on reconnect. Reconnect is also single-flight guarded (no leaked concurrent clients), detaches the old client's listeners before re-init, and tracks the reconnect timer so logout can cancel it.
- **Bug #21 (race) — `presencesReady` never reset on disconnect.** The flag stayed `true` across a drop, so (a) the heap sender could fire into a dead socket and (b) the `false→true` transition that flushes offline-queued messages never re-armed on reconnect. `onDisconnect` now resets `presencesReady = false`; on reconnect `onOnline` flips it back `true` only after `allRoomPresences` has synchronously re-sent presence — queued messages flush after the re-join, not before.
- **Idle stale-JWT loop (follow-up to #17).** When a JWT expired during idle and the credential refresh produced no new password, the client used to retry forever with stale creds (`not-authorized` loop). It now detects two consecutive no-progress refreshes, latches `authExpired`, suppresses further reconnects, and emits an `ethora:authExpired` DeviceEventEmitter event so the host can re-authenticate (e.g. re-mount `<Chat>` with a fresh `jwtLogin.token`). `ethora:retryBootstrap` clears the latch.
- **Bug #4 (residual) — fire-and-forget `client.send()` leaks.** A global send wrapper attaches a no-op `.catch` to every underlying send promise (while returning the same promise to awaiting callers), so a send that rejects during socket teardown no longer surfaces as `Uncaught (in promise)`.

#### Unread tracking

- **Bug #19 — `useUnread()` stuck at 0 in tab navigators.** When `<ChatRoom>` stays mounted across tabs, blur never released the active-room marker, so the unread middleware treated the room as "always being viewed". `useChatRoomFocus` now releases the active room (`setCurrentRoom({ roomJID: null })`) and stamps `lastViewedTimestamp` on blur — counting resumes the moment the user leaves the tab.
- **Bug #20 — scroll-to-bottom badge inflated by loading older history.** The badge now snapshots the newest message timestamp when you leave the bottom and counts only messages newer than that snapshot, so back-pagination (load-more) of older messages can never bump the count.
- **Cold-start badge — incoming `lastViewedTimestamp: 0` clobbered the persisted marker.** `addRoom` now ignores an incoming `0` placeholder (the stanzaHandlers default) and preserves the hydrated/persisted value, so badges are correct on first paint after a cold start.

#### Messaging

- **Translated / resent messages stuck pending + duplicated.** `sendTextMessageWithTranslateTagStanza` didn't forward a client message id, so translated sends (and every resend that took the translate path) went out without an id — the server echo arrived with a different id and never reconciled with the optimistic bubble (stuck "pending" + a duplicate). It now accepts and forwards `customId`; `useHeapSender` and `resendMessage` pass it.

#### UI / customization

- **Bug #14 — delete confirmation is now a small centered dialog with a white action label.** Confirm-style modals render in a dedicated bounded `compactDialog` view (never full-screen), and the filled (e.g. red Delete) button now passes `color="#FFFFFF"` explicitly so the label isn't black-on-red.
- **Bug #13 — context-menu placement is now measured, not estimated.** `MessageInteractions` measures the rendered menu height via `onLayout` and places the menu just above/below the message's actual bounding box, clamped to the viewport — the menu sits adjacent to the message instead of floating far above it.
- **New `config.disableConnectionErrorOverlay`.** Swaps the full-screen "Connection error" overlay for a small non-blocking `ConnectionBanner`, so a transient reconnect doesn't take over the whole screen.
- **Android context menu polish.** Hairline dividers (instead of an all-sides border that rendered badly on Android) and explicit row label styling (`includeFontPadding: false`) so menu rows match iOS.

#### Media

- **`expo-av → expo-video` migration for video.** `VideoMessage`, `FilePreviewModal`, and `MediaFilePreview` now use `expo-video` (`useVideoPlayer` / `VideoView`); the inline bubble shows a tappable poster that opens the full-screen player. **`expo-video` is now a peer dependency** — run `npx expo install expo-video`. Audio still uses `expo-av`.

### Tests / internal

- Added regression tests: unread cold-start + tab focus/blur, `useUnread` perturbations, the `presencesReady` online/disconnect cycle, and the JWT-login bootstrap mock now stubs `setOnOnline` / `setOnAuthExpired`.
- Repaired stale tests that lagged source changes (apiClient token getters, `onGetLastMessageArchive(stanza, xmppWs)`, `createRoom` arity) and re-pointed the package-shape test at the `exports` map (the field consumers actually resolve), since the repo root doubles as the Expo testbed and `main` must stay `index.js`.

## [26.5.8]

Follow-up to 26.5.7 covering the customer-retest list — every "Not in 26.5.7 / Worsened" item, plus a usability gap in `useUnread` and a new scroll-to-bottom UX affordance.

### Fixed

#### Media (the long tail of bug #10 and #9)

- **Bug #10 — `/files/` 500 retries with singular field name.** Removing the manual Content-Type header in 26.5.6 wasn't enough — some Ethora deployments expect the field name `file` (singular) instead of `files` (plural). The plural form works for image uploads via permissive server sniffing but rejects video/audio/docs with 500. `useSendMessage.sendMedia` now: (a) coerces iOS `assets-library://` URIs to `file://` so RN's FormData polyfill builds a real multipart blob, then (b) tries `files` (plural — current SDK default), and (c) on 500 retries with `file` (singular). Also surfaces `serverBody` / `fileBlob` shape in the diagnostic log for any remaining 500s.
- **Bug #9 — video controls hidden behind tab bar; audio preview blank.** `FilePreviewModal`: video player now sits inside a wrapper with `paddingBottom: 80` so the `useNativeControls` overlay clears the host app's tab bar + iOS home indicator. New `audio/*` switch case renders the existing `AudioMessage` (expo-av) component inside an info card with filename — audio messages from other users are now actually playable in the preview.

#### Sending / send-state

- **Bug #18 — silent send failures stuck on "sending..." forever.** Send paths (`sendMessage` + `sendMedia` in `useSendMessage`) now arm a 30-second watchdog after the optimistic bubble lands. If no server echo arrives in that window AND the message wasn't already explicitly marked failed by the catch path, the watchdog flips it to "Failed — tap to retry". Covers the no-internet case where XMPP buffers the send without throwing.

#### UX

- **Bug #6 — Android keyboard blocking the chat input + flicker.** 26.5.7's `behavior={undefined}` on Android broke hosts that disable `adjustResize` via `softInputMode`. Reverted to `behavior="padding"` on both platforms — padding adds bottom-padding equal to the keyboard height without changing layout height, so no double-resize (no flicker) and the input is always lifted regardless of the host's softInputMode.
- **Bug #13 — context menu overcorrected too high.** The 26.5.7 `MENU_HEIGHT=280` over-estimate (based on a phantom reactions strip) forced the menu above the bubble even when there was room below. Real `MessageInteractions` is 1-3 rows × ~40px (40 for non-own, ~140 for own). Lowered to 160; the prefer-below path now wins for normal cases and only switches to above when the bubble genuinely lacks bottom space.
- **Bug #14 — delete confirmation still full-screen.** The 26.5.7 `compact` style used `height: 'auto'` which RN doesn't honour — the styled-component's `height: 100%` won. Replaced with `height: undefined` + `minHeight: 0` + `alignSelf: 'center'`. Now a properly small (max 360 wide) centered dialog.

#### Promise hygiene (bug #4 part 2 — exhaustive sweep)

The `(in promise, id: 0)` and `(in promise, id: 2)` red screens were not all in `useChatWrapperInit`. An exhaustive sweep across `src/` found and patched:

- `ChatWrapper.tsx` — the outer `await initializeClient(...).then(c => {...})` callback had no `.catch()`. Converted to `await` + inner try/catch.
- `ChatWrapper.tsx` — three fire-and-forget `refresh()` calls (legacy / storedClient / provider branches) — wrapped each with `.catch((err) => console.warn('refresh failed', err))`.
- `usePushNotifications.ts:81` — `getInitialNotification().then(...)` without `.catch()` — added one.
- `usePushNotifications.ts:54` — `initToken()` was fire-and-forget in the bootstrap `useEffect`; any sync throw before the inner try-block leaked. Added `.catch`.
- `networking/xmpp/getRoomsPaged.xmpp.ts` — **the most likely id:0/id:2 culprit.** `client.send(message)` was NOT awaited inside an `async` Promise executor, so when the socket was closing during reconnect, the send rejection escaped the try/catch entirely. Rewrote without the async executor, captured the send promise, attached `.catch` synchronously, and rewrote the timeout chain to attach its rejection handler at construction time (no race).
- `networking/xmpp/presenceInRoom.xmpp.ts` — same `new Promise(async (resolve, reject) => …)` anti-pattern with a racy `.catch(reject)` on the timeout. Rewrote to use a regular promise constructor + an inner async IIFE that explicitly funnels every failure path through `reject()`.

Also installed a **dev-only global unhandled-rejection tracker** (`src/utils/installPromiseRejectionTracker.ts`, mounted from `ReduxWrapper`) that catches any future leaks and prints the actual rejection value + stack to Metro logs (works on Hermes via `HermesInternal.enablePromiseRejectionTracker` and on the standard `unhandledrejection` event). No-op in production builds. If a new red-screen ever appears, the integrator now sees exactly where it originates.

#### Media preview (bug #9 — true inline preview)

`FilePreviewModal` now renders office docs (DOC / DOCX / XLS / XLSX / PPT / PPTX / TXT / CSV / RTF) inline via a new `DocumentViewer` component that embeds Google's free `docs.google.com/gview?url=…&embedded=true` viewer in a `react-native-webview`. The previous default case showed only an info card; for these MIME types the user now sees the actual document content. PDF keeps its existing local-download-then-WebView path (`PdfViewer`). Truly unrenderable binary types still fall through to the info card with filename + download prompt.

### Added

- **`useChatRoomFocus({ roomJID, isFocused })` hook** — public unread-tracking hook for tab-based navigators where `<ChatRoom>` never unmounts. Mirrors the mount/unmount lifecycle internally — focus stamps `lastViewedTimestamp = 0` (clears badge, marks active room), blur stamps `Date.now()` (so future messages count). Eliminates the consumer workaround of importing `store` / `setLastViewedTimestamp` / `setCurrentRoom` from internal `src/` paths.
- **Unread-count badge on the scroll-to-bottom arrow.** When the user is scrolled up and new messages arrive, the down-arrow now shows a count chip (capped at `99+`). Resets when they scroll back to the bottom.
- **New granular config flags** for member-list actions (bug #16 done right this time):
  - `disableMemberProfileActions?: boolean` — hide the whole action block.
  - `hideMemberSendMessageAction?: boolean` — hide only "Message".
  - `hideMemberCopyIdAction?: boolean` — hide only "Copy User Id".

### Changed

- **Reverted 26.5.7 widening of `disableProfilesInteractions`.** It now controls message-list avatar taps only (its original scope) — the new granular flags above handle the chat-info member actions per-button instead of all-or-nothing.
- **`roomsSlice.addRoom` cold-start fix.** The previous `Date.now()` default for `lastViewedTimestamp` (used when the payload didn't carry one and there was no existing room) stamped a "now" marker that made messages sent while the app was killed look already-read on next launch. Now anchors to the newest message in the payload (so already-loaded history is "seen" but anything strictly newer counts as unread), falling back to `0` only when there are no messages yet (lets the private-store hydration set the real marker).

## [26.5.6]

Closes the open items from the 26.5.5 customer bug tracker plus seven new ones (uploads, media preview, XMPP idle recovery, send failures, UI polish, customization gates). One existing config flag (`disableProfilesInteractions`) gets its semantics widened — everything else is additive.

### Fixed

#### Networking / auth

- **Bug #10 — Video/audio/doc uploads returning 500.** `uploadFile()` pre-set `'Content-Type': 'multipart/form-data'` manually, which stripped the auto-computed multipart boundary axios attaches when the body is `FormData`. Images happened to slip through permissive server sniffing; video/audio/docs were rejected with 500. Removed the header — axios now sets `multipart/form-data; boundary=...` correctly and all media types upload.
- **Bug #17 — XMPP idle reconnect loop after JWT expiry.** Previously, when the JWT-derived XMPP password went stale during idle, reconnect retried with the cached password forever and the user had to kill the app. `XmppClient` now detects SASL `not-authorized` (via `lastAuthError`) and awaits fresh creds from a `credentialsProvider` before `initializeClient()`. The provider is wired automatically for **every** auth mode:
  - `jwtLogin` — re-exchanges the JWT via `/users/client`.
  - `userLogin` / `customLogin` / persisted user — calls `/users/my` against the redux/AsyncStorage user, and on a 401 falls back to `/users/login/refresh` with the cached `refreshToken` and retries.
  - Optional `refreshTokens.refreshFunction` runs first (when supplied) so non-Ethora deployments can plug in their own token endpoint before the SDK touches its own.

  Concurrent reconnects share a single in-flight refresh via a `credentialsRefreshInFlight` guard. New exported helper `refreshUserCredentialsForXmpp(config)` for consumers who want to mint fresh XMPP creds manually.
- **Bug #4 — Unhandled promise rejections in `useChatWrapperInit`.** Three `.then()` chains that surfaced as "Uncaught (in promise)" red-screens in dev (initializeClient, two getChatsPrivateStoreRequestStanza paths) are now `await` + local `try/catch` blocks. Init continues even if the private-store fetch rejects.

#### Media (receive + send)

- **Bug #9 — Cannot preview / download docs / video / audio sent by others.** `FilePreviewModal.saveFileToDownloads` passed a no-extension cache filename to `MediaLibrary.createAssetAsync`, which threw "Could not get the file's extension". New `mimeToExtension` util provides a MIME→extension table and three helpers — `getExtensionForMime`, `filenameFromUrl`, `ensureFilenameHasExtension`, `deriveDisplayFilename` — used by both download paths in `FilePreviewModal` and the bubble in `MediaMessage`. The bubble now derives the displayed filename via the chain `fileName → originalName → URL pathname → media_<ts>.<ext>` so received documents never show as `MediaFile` again, and the default-case preview renders a proper file-info card (name + MIME + "tap save to download") instead of an unfriendly beige notice.

#### UX

- **Bug #11 — Keyboard dismissed on every scroll.** `MessageList.handleScroll` no longer calls `Keyboard.dismiss()`. The FlatList now passes `keyboardShouldPersistTaps="handled"` and `keyboardDismissMode="interactive"` so iOS drag-to-dismiss still works, but touching the list with the keyboard open keeps it open.
- **Bug #18 — Failed messages stuck in "sending..." forever.** `roomHeapSlice` now also tracks `failedMessages: Record<id, FailedMessagePayload>`. `useSendMessage`'s catch blocks dispatch `markMessageFailed` with the original payload (text body, or media `data`/`type`) so a retry can replay without the consumer re-picking a file. `Message.tsx` renders a red `! Failed — tap to retry` next to the bubble; tap fires `retryMessage(id)` which clears the failure and re-sends. New `eventHandlers.onMessageRetry` hook for telemetry.
- **Bug #14 — Delete confirmation modal full-screen.** `ModalWrapper` gains a `compact?` prop that constrains the container to `maxWidth: 360, padding: 24, borderRadius: 16` and centers it. `ChatWrapper`'s delete confirmation passes `compact` — now a small centered dialog rather than an edge-to-edge overlay.
- **Bug #13 — Long-press context menu off-screen on last message.** `Message.tsx` replaced the hard-coded 150 px threshold with a dynamic placement: estimate `MENU_HEIGHT = 280`, treat `config.keyboardVerticalOffset` as a tab-bar/safe-area proxy, prefer below → fall back to above → clamp into the visible region. No more menus stranded in the bottom corner.
- **Bug #6 — Android keyboard flicker + hidden input.** `KeyboardAvoidingView` on Android was set to `behavior="height"`, which double-handled the resize on top of the manifest's `adjustResize`. Switched to `behavior={undefined}` on Android — `adjustResize` alone resizes the window cleanly with no flicker.

### Added

- **`mimeToExtension` helper** (`src/helpers/mimeToExtension.ts`) — single source of truth for MIME→extension mapping covering image / video / audio / document / archive types, with `.bin` last-resort fallback. Public via barrel exports.
- **`config.disableChatHeaderBurgerMenuIcon?: boolean`** — Bug #15. Hides the burger icon entirely (the icon that opens the chat-header dropdown). The existing `chatHeaderBurgerMenu` flag controls dropdown visibility only — set the new flag when you want neither the icon nor the dropdown to render (patient-facing apps, single-room apps).
- **`config.eventHandlers.onMessageRetry`** — fires whenever the user taps the new failed-message retry indicator. `{messageId, roomJID, messageType}`.
- **`XmppClient.setCredentialsProvider(fn)` / `XmppClient.updateCredentials(user, pass)`** — extension points used by the JWT auto-recovery path. Safe to call multiple times.

### Changed

- **`config.disableProfilesInteractions: true` now also hides the "Send message" / "Copy User ID" actions in chat info** (Bug #16). Previously the flag only blocked taps on message-list avatars; chat-info member taps still revealed the actions. The widened semantic matches what the flag name implies. If you relied on the previous narrow scope, file an issue and we'll add a separate sub-flag.

### Known limitations

- **Auto-recovery for `userLogin` needs a `refreshToken` on the user object.** The `/users/my` + `/users/login/refresh` chain requires a refreshable session — if the consumer supplies a fully-static User with no `token`/`refreshToken`, the SDK has no way to mint a fresh xmppPassword and the user has to re-mount the chat. Practical guidance: pass at least `token` + `refreshToken` from your auth backend, OR supply `refreshTokens.refreshFunction` to wire your own refresh endpoint.

## [26.5.5]

This release is the deep cleanup of the SDK's legacy-RN native-module debt. Before it, even a simple `npx expo prebuild` consumer had to wire up a `withEthoraShims` Metro shim, install `babel-preset-expo`, and accept a `Cannot find module 'emoji-mart'` bundle error before anything ran. After it, **no Metro shim is required** and the consumer install is one SDK + one `npx expo install` of the optional-feature peers.

### Removed

- **`emoji-mart`** (entirely). Web-only library that previously needed a Metro shim. `ContextMenuComponents.tsx` exported a `StyledPicker` wrapping its `<Picker />` — dead code, never imported. `LastMessageEmoji.tsx` used its emoji data map for `:id:` → unicode resolution — replaced with raw render (reaction stanzas already ship the unicode glyph, the id dance was unnecessary).
- **`react-native-image-crop-picker`**. `ChatProfileModal` now uses `expo-image-picker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1,1] })` — same crop UX, no extra native module. `ModalSelectMedia` deleted entirely (no consumers).
- **`react-native-document-picker`**. The send-path already used `expo-document-picker`; the only file referencing the legacy package was `ModalSelectMedia` (deleted).
- **`react-native-audio-recorder-player`**. `AudioRecorder` / `AudioInput` / `RecordingIndicator` were never wired into any visible chat surface — deleted. If/when voice messages get a UI, it should be built on `expo-av`'s `Audio.Recording`.
- **`react-native-permissions`**. `ChatProfileModal` was the only consumer; replaced with `expo-image-picker.requestMediaLibraryPermissionsAsync()` which owns its own permission prompt.
- **`@react-native-clipboard/clipboard`**. `OperationalModal` was the only consumer — dead component, no callers. The live copy-message flow in `MessageInteractions` already used `expo-clipboard`.
- **`react-native-emoji-selector`**. `MessageInteractions` imported it, but the JSX that mounted the picker was commented out (along with the inline reaction strip). Removed the import + the dead `pickerVisible` state + the `fixedEmojiIds` / `convertIdToEmoji` helpers.
- **`@react-native-community/checkbox`**. `UsersList/StyledComponents` styled it; consumer ([`UsersList.tsx`](src/components/UsersList/UsersList.tsx)) now uses a new minimal RN-native [`Checkbox`](src/components/UsersList/Checkbox.tsx) (one `Pressable` + a check glyph, 60 lines). Same `value` / `onValueChange` props.
- **8 dead entries from `OPTIONAL_NATIVE_MODULES`** in `metro.js`. After the cleanup, the list is empty entirely — `withEthoraShims` is preserved as a no-op for backward compat with consumers that already call it.
- **Ambient declarations** for all the removed modules (and `react-native-fs`, which had zero importers) dropped from [`types/declarations.d.ts`](types/declarations.d.ts).
- **Dead components removed**: `src/components/OperationalModal/`, `src/components/Modals/ModalSelectMedia/`, `src/components/InputComponents/AudioInput.tsx`, `src/components/InputComponents/AudioRecorder.tsx`, `src/components/InputComponents/RecordingIndicator.tsx`, `src/components/InputComponents/MediaInput.tsx`. None of them had a single importer in `src/`.

### Changed

- **README install section rewritten.** Two steps now: (1) `npx expo install` for required peers + (2) `npx expo install` for the optional Expo-media peers. The Metro-shim step is gone — explicitly noted as no longer required.

## [26.5.4]

### Changed

- **Error overlay rewritten** — previously showed a stray "There was an error. Please, refresh the page" message (web-port artefact, no action for the user). Now renders a native RN modal with: a clear "Connection error" title, a description of where the error came from (bootstrap auth failure / no user / init exception), the actual error message extracted from the axios response when available, and a **Retry** button. Retry dispatches a `ethora:retryBootstrap` event the XmppProvider listens to — clears the bootstrap key cache and flips the status back to `idle` so the next effect run re-resolves the user from scratch, without unmounting the chat.

## [26.5.3]

### Changed (breaking on paper, transparent in practice for Expo apps)

- **Moved Expo packages from `dependencies` to `peerDependencies`** with `peerDependenciesMeta.<name>.optional: true`. Affected: `expo-av`, `expo-clipboard`, `expo-document-picker`, `expo-image-manipulator`, `expo-image-picker`, `expo-media-library`. Reason: when these sat in `dependencies`, npm sometimes nested them under `node_modules/@ethora/chat-component-rn/node_modules/` (version dedup with the consumer's Expo SDK), and Expo's `app.json` plugin resolver — which only scans the project root's `node_modules/` — failed to find them. Consumers running `npx expo prebuild` got a `PluginError: Failed to resolve plugin for module "expo-image-picker"`. Moving them to peers makes consumers install once at top level (typically `npx expo install expo-image-picker expo-document-picker ...`), which is what every other RN-with-native lib does. Bonus: the SDK tarball drops 6 transitive Expo packages.

  > **Upgrade note**: In your app, run `npx expo install expo-av expo-clipboard expo-document-picker expo-image-manipulator expo-image-picker expo-media-library` once. Or only the ones you actually use — they're all optional, runtime imports fail loudly with the same `Cannot find module 'expo-av'` you'd see today.

## [26.5.2]

Integration-hardening round: closes a batch of runtime issues and a structural "ships raw TS" problem that surfaced during a real-world consumer integration.

### Added

- **Build pipeline via `react-native-builder-bob`** — package now ships in three flavours: `lib/commonjs/` (CommonJS for Node-resolution consumers), `lib/module/` (ESM for bundlers), and `lib/typescript/` (`.d.ts` declarations). `package.json`: `main → lib/commonjs/main.js`, `module → lib/module/main.js`, `types → lib/typescript/main.d.ts`. `react-native` / `source` still resolve to `src/main.ts` so Metro keeps consuming raw TS directly (preserves source maps / debug experience), but every other resolver — `tsc`, webpack, vite, Node-side tooling — now gets the compiled artefact. Bob's `commonjs` / `module` targets transpile via Babel; the `typescript` target shells out to `tsc -p tsconfig.build.json` for the type emit. `bob build` is wired through `npm run build`; `prepack` runs `clean && build` so `npm pack` / `npm publish` always emit fresh artefacts.
- **CI** — `.github/workflows/ci.yml` with two jobs: `test` (typecheck, jest, build) and `consumer-smoke` (`npm pack` → install the tarball into a temp consumer fixture → run `tsc --noEmit` against `import { Chat, XmppProvider }`). Catches the ship-raw-source class of regression before publish.
- **[`docs/unread-tracking.md`](docs/unread-tracking.md)** — full reference for the `useUnread` hook: count-computation rules, XMPP private-store persistence, `disableLastRead` opt-out, edge cases the implementation handles, file map.
- **Ambient declarations** for `expo-av` and `expo-media-library` in `types/declarations.d.ts` (moved here from `src/` so bob's Babel pass doesn't trip on namespace+const ambient syntax). Kept in `tsconfig.json` include path; not shipped to consumers (skipLibCheck handles missing peer types in their tsc).

### Changed

- **`postinstall` → `prepare`** in `package.json` scripts. The previous `postinstall: patch-package` ran on consumer install too, and broke their installs because `patch-package` wasn't in their `node_modules`. `prepare` only runs in dev contexts (top-level `npm install`, pre-publish, pre-pack) and is the npm-standard hook for "apply local dev fixups".

### Fixed

#### Runtime crashes / red screens

- **`addRoomViaApi` crashed on the new-arch path** — the function was imported in `useGetNewArchRoom`, `AddMembersModal`, `UserProfileModal`, and `NewChatModal` but never existed in `roomsSlice`. Added as a `createAsyncThunk` that dispatches a new `addRoomFromApi` reducer. Consumers can now set `newArch: true` instead of the previous `newArch: false` workaround.
- **Unhandled promise rejections** from `getRoomsStanza` / `getHistoryStanza` `.then()` chains with no `.catch()` — these surfaced as red-screen errors that integrators had to suppress with `LogBox.ignoreLogs`. Added `.catch` handlers in `ChatWrapper` (three call sites) and `ThreadWrapper`.
- **`onGetMembers` wiped REST-loaded members** by dispatching an empty `roomMembers: []` whenever a quiet room's IQ stanza arrived without activities. Now early-returns on empty activities and merges with existing per-jid members instead of replacing.

#### Keyboard

- **iOS chat input didn't lift on focus** — `KeyboardAvoidingView` from `react-native-keyboard-controller` was imported in `ChatRoom`, but the required `<KeyboardProvider>` root wrapper was never mounted, so the controller silently fell back to a no-op. Mounted `<KeyboardProvider>` at the chat root in `ReduxWrapper`. Consumers can drop their RN stock `KeyboardAvoidingView` wrapper workaround.
- **Android keyboard flicker** — `behavior="padding"` on Android collided with the manifest's native `adjustResize`. Switched to platform-aware `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.

#### Media (receive)

- **Receiving audio is now playable** — `AudioMessage` previously rendered an empty `ScrollView` because the fetch/decode pipeline was commented out and amplitudes were never populated. Rewritten with `expo-av` `Audio.Sound`, play/pause control, progress bar, and duration display.
- **Receiving video is now playable** — `VideoMessage` previously bound `onBuffer={handleOpen}` (re-opened the preview modal in a loop) and the play/pause toggle called `seek(0)` instead of toggling `paused`. Rewritten with `expo-av` `Video` + `useNativeControls`.
- **Receiving documents now renders the download tile** — the `application/octet-stream` mime (the default many backends use for arbitrary binaries: PDF, DOCX, archives) was routed to the broken `AudioMessage` branch in `MediaMessage`. Now falls through to `FileDownload` for non-audio extensions and only routes to audio when the filename carries `.mp3 / .m4a / .wav / .aac / .ogg / .flac`.

#### Media (send)

- **Camera now captures both photos and videos** (was photos-only).
- **Gallery picker accepts both photos and videos** (verified end-to-end: gallery → file preview → upload via `/files/` multipart → XMPP `sendMediaMessage` stanza with location/mime metadata).
- Migrated both pickers from the deprecated `ImagePicker.MediaTypeOptions.All` enum to the new `mediaTypes: ['images', 'videos']` array syntax.

#### Layout / cosmetics

- **`MediaModal` stray semicolon** after `</View>` inside `<Modal>` — the `;` parsed as a text child of `Modal`, sibling to the wrapping View, breaking flex layout. Removed. Consumers can drop their local patch.

#### Type safety

- All previously-flagged `tsc --noEmit` errors resolved (`EXIT 0`).
- Replaced 4 `as any` casts in `stanzaHandlers.ts` with proper `Element` / `RoomMember` / `Partial<DataXml>` typing.
- Exported previously-internal state types (`ChatState`, `RoomMessagesState`, `roomHeapSliceState`, `ButtonProps`) so declaration emission can name them.
- RTK slices now carry explicit `Slice<State, typeof reducers, Name>` annotations with `WritableDraft<State>` reducer params to prevent tsc from inlining immer's internal `WritableNonArrayDraft` into the emitted `.d.ts` (TS4023).
- `roomsSlice.ts` switched its `XmppClient` reference from the baseUrl-rooted `'src/networking/xmppClient'` to a type-only relative `'../networking/xmppClient'`.

## [26.05.01]

### Added

- **`scripts/ensure-emulator.js`** — runs before `expo run:android` (wired into the `android` npm script). If `adb devices` shows nothing connected, resolves `ANDROID_HOME` (env or platform default), picks the first AVD from `emulator -list-avds` (or honours `ETHORA_AVD`), launches it detached, and polls `adb shell getprop sys.boot_completed` until it returns `1` (max 2 min). Eliminates the opaque "No Android connected device found, and no emulators could be started automatically" error that bit first-time developers even when they had AVDs configured. Surfaces clear next-step guidance when `ANDROID_HOME` / platform-tools / emulator / AVDs are missing. ~50 ms overhead on the happy path (device already attached).

### Changed

- **iOS / Android npm scripts no longer pass `--no-install`.** The previous `--no-install` flag (added then reverted in this release cycle) had the side-effect of skipping `pod install` during `expo run:ios`, which then broke xcodebuild with "The sandbox is not in sync with the Podfile.lock". The actual root cause of the original yarn-install failure was that `yarn.lock` was checked in alongside `package-lock.json`, so expo defaulted to yarn even though the project is npm-managed. Removing `yarn.lock` (see below) restores normal flow without needing `--no-install`.
- **README's "Build + run" recipe** updated to reflect the npm-only flow + brief note explaining why `yarn.lock` is intentionally absent.

### Removed

- **`yarn.lock`** — the project is npm-managed (`package-lock.json` is the canonical lockfile, README uses `npm install`, no `packageManager` field in `package.json`). Removing the legacy `yarn.lock` lets `expo run:*` default to npm for its post-prebuild reinstall step. Future contributors should not re-introduce it.
- **`src/api.config.ts`** — was an orphan duplicate of the repo-root `api.config.ts`, with no importer in the source tree. It was being included in the npm tarball via the package.json `files: [src, ...]` entry, so every consumer was downloading the legacy bundled BASE-app JWT and a hardcoded dev test user (see "Fixed" below for the policy story). Deleted outright since nothing depended on it.
- **`web/src/api.config.js`** — same orphan-duplicate story as `src/api.config.ts`. Module resolution prefers the `.ts` sibling; nothing imported the `.js` variant.

### Fixed (product-code-policy sweep)

Removed compiled-in Ethora endpoints, dev-team test credentials, and customer names from the source tree.

- **`src/networking/apiClient.ts`** — dropped the dangling import from `../../api.config` (the repo-root file isn't even in the published tarball, so this import would have errored at install time for any consumer). `DEFAULT_BASE_URL` cleared to `''`; `currentAppToken` initialised to `''`. Consumers must now pass `baseUrl` via `<Chat config>` or call `setBaseURL(baseUrl, appToken)` before any REST call.

  > **Behaviour change**: previously `<Chat>` defaulted to `api.chat.ethora.com/v1` when no `baseUrl` was passed in props. From this release that is no longer the case. If you relied on the implicit cloud default, add `baseUrl: 'https://api.chat.ethora.com/v1'` (or your own host) to your `<Chat config>` block. The README's "Default backend endpoints" section is left in place as a reference for the canonical values.

- **`api.config.ts`** (repo root) — appToken / defaultUser / defRoom replaced with `PLACEHOLDER_*` values. Shape preserved so the optional `defaultUser` smoke path in `App.tsx` still compiles after a local edit.
- **`src/components/MainComponents/LoginWrapper.tsx`** — hardcoded fallback email / password in `loginUserFunction` replaced with empty strings. `loginEmail` now fails cleanly on empty creds (hits catch, returns null) when the consumer hasn't passed `user.email` / `user.password` — same end behaviour, minus the leaked dev credentials.
- **`web/src/api.config.ts`** — same placeholder treatment as the repo-root file.
- **`web/src/App.tsx` + `web/src/AppLoginChats.tsx`** — hardcoded `api.chat.ethora.com` plus a `BASE_CONFIG` app id cleared to empty strings. Removed commented-out roomJID literals that referenced a customer subdomain.
- **`web/src/AppLoginChatsNpm.tsx`** — replaced hardcoded customer dev-environment endpoints with empty strings and rewrote the comment referencing a Slack thread in neutral language ("typical host-integrator flow where an external auth system mints the Ethora user JWT and the chat UI is dropped in beneath it"). The file's dev-recipe value is preserved; its purpose is documented by its shape, not by the specific endpoint.
- **`AppLoginChatsRn.tsx` `DEFAULT_CREDS`** — `baseUrl` / `xmppHost` / `xmppDevServer` / `conference` cleared to empty strings; the Setup tab opens blank for runtime configuration. (The `@ethora/setup` CLI patches these defaults from an `~/.ethora/profiles.json` profile when it clones the testbed for you.)
- **`__tests__/appLoginChatsRn.test.tsx`** — the JWT-save flow test now types a `baseUrl` explicitly into the Setup form (was previously relying on the hardcoded default to assert ReduxWrapper's baseUrl).

### Fixed (storage-key migration)

- **`src/services/pushSubscriptionService.ts`** — `SUBSCRIBED_ROOMS_KEY` renamed to `'ethora_subscribed_rooms'`. To avoid orphaning existing subscriptions on any installed app, `loadSubscribedRoomsFromStorage` now reads the new key first; if it's empty and the legacy key has data, the value is copied across and the legacy key is deleted (wrapped in try/catch so a migration failure can't block the load). `reset()` defensively clears both keys. The legacy-key constant and the migration block can be removed in the next major release.

## [26.04.02]

### Added

- **Unread tracking via server-side private store, end-to-end.**
  - On entering a chat (`<Chat>` mount / `useChatWrapperInit`) the SDK fetches `chatjson:store` (`getChatsPrivateStoreRequest`) and applies the per-room last-viewed marker. Comparison now uses `msg.id` (server-authoritative microseconds-since-epoch prefix) instead of the client-derived `msg.date` — eliminates drift from `createMessageFromXml`'s `Date.now()` fallback.
  - `flushLastViewedToPrivateStoreStanza` (new helper on `XmppClient`) merges the in-memory last-viewed map into the server's private store in a single round trip. Refuses to overwrite a newer marker so concurrent clients don't trample each other.
  - Trigger points:
    - **App background / inactive** — `AppState.addEventListener('change')` in `XmppProvider` flushes when the app leaves `active`.
    - **Tab change away from the chat** — the testbed flushes when the user moves from the Chat tab to Setup or Logs.
    - **Logout** — `logoutService.performLogout` flushes (rooms with `unreadMessages === 0` plus the active room) before the XMPP socket is closed. Rooms with outstanding unread keep their old marker so they stay unread on the next login.
- **New room hydration default** — `addRoom` now preserves an existing `lastViewedTimestamp` if one is already set; otherwise stamps `Date.now()`. Stops `/chats/my`-hydrated MAM history from being counted as 100% unread on first paint.
- **`instructions.md`** — full RN config guide aligned with the web package docs. Includes a reference `XmppProvider` + `Chat` example, the single-init contract, and a grouped reference for every field in `IConfig`.
- **`patches/expo-document-picker+14.0.8.patch`** + `patch-package` wired into `postinstall` — fixes the iOS 26 DocumentManager.framework SIGABRT on attachment cancel.

### Changed

- **`unreadMiddleware` + `countNewerMessages`** now use `msgSortableMs(msg)` (extracts the 13-digit ms prefix from `msg.id`) instead of `new Date(msg.date).getTime()`. The reducer and the middleware can no longer disagree about the comparison source.
- **`InputContainer` padding** — top `12px` → `8px`, bottom `12px` → `4px`. The send-input row now sits ~8px tighter against the bottom safe-area inset.
- **`RoomList` header / search alignment** — `HeaderRoomList` now uses `paddingHorizontal: 16` and a fixed 40px left/right gutter so the centered title stays optically centered regardless of avatar/menu width. `SearchInput` wrapper margin reset; icon padding trimmed. `chatList` padding aligned to `paddingHorizontal: 16`, matching the header so the avatar column lines up under the search icon.
- **`logoutService.performLogout`** — added the private-store flush step (with a 2-second timeout race so logout never hangs on a stalled stanza).
- **`PickingContext` retention** — `DocumentPickerModule.swift` now appends the delegate to a `retainedDelegates` array on success or cancel and releases it 3 seconds later via `DispatchQueue.main.asyncAfter`. Prevents `DOCWeakProxy` from messaging a deallocated target when DocumentManager's XPC delivers a late callback. Removed the spurious "Picking context lost" error log on the second cancel callback (both `documentPickerWasCancelled` and `presentationControllerDidDismiss` fire on swipe-down dismiss — the second one is normal re-entry).

### Fixed

- **App SIGABRT when cancelling the attachment picker.** Crash signature `EXC_CRASH (SIGABRT)` with `-[DOCWeakProxy forwardingTargetForSelector:].cold.1` originating from `DocumentManager.framework`. iOS 26 delivers a late XPC delegate callback after `pickingContext = nil` had already released the swift delegate; the proxy then can't forward and the runtime aborts. See the patch description above.
- **Unread over-count after logout → login.** Previously, the active room's in-memory `lastViewedTimestamp = 0` ("user is viewing here") was never written back to the private store, so the next session re-counted everything since the prior cold start as unread. The new logout flush stamps `Date.now()` for the active room (and any other room with zero unread) before XMPP disconnects.
- **`smallHooks` logout test** — updated to await `performLogout()` and asserts the actual dispatch order (`roomMessages/setLogoutState → roomHeapStore/clearHeap → chat/logout`). The mocked `store` now also exposes a minimal `getState` shape so the new pre-disconnect flush doesn't TypeError.

### Notes

- iOS bundle identifier — verified `com.ethora.chatcomponentrn` in the compiled `Info.plist`. The previous mismatch (`org.name.ethoraChatComponentRN`) was a stale DerivedData product; a clean rebuild emits the correct id from `app.json` + `ios/ethoraChatComponentRN.xcodeproj/project.pbxproj`.
- iOS privacy keys — `NSPhotoLibraryUsageDescription`, `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, `NSPhotoLibraryAddUsageDescription` confirmed present in the source `Info.plist`. The expo-image-picker plugin in `app.json` keeps them in sync on `expo prebuild`.

## [26.04.01]

- Prior release. See `git log` for per-commit history.
