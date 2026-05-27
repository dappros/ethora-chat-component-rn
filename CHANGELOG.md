# Changelog

All notable changes to `@ethora/chat-component-rn` are listed here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project doesn't follow strict semver yet — version corresponds to the `package.json` field.

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
