# Changelog

All notable changes to `@ethora/chat-component-rn` are listed here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project doesn't follow strict semver yet — version corresponds to the `package.json` field.

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
