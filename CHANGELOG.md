# Changelog

All notable changes to `@ethora/chat-component-rn` are listed here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project doesn't follow strict semver yet — version corresponds to the `package.json` field.

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
