# Changelog

All notable changes to `@ethora/chat-component-rn`.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows date-based versioning (`YY.MM.PATCH`).

## [Unreleased]

### Fixed — Customer feedback round (Vitall / Ankush, May 2026)

The previous SDK shipped raw TS sources to consumers and accumulated a
batch of runtime issues that surfaced during a real integration. This
release closes that loop end-to-end.

#### Structural

- **Build pipeline**: package now ships compiled `.d.ts` declarations
  under `lib/typescript/`. `package.json` `types` points there; `files`
  includes `lib/`; a `prepack` script runs `tsc -p tsconfig.build.json`
  on publish. Consumers' `tsc --noEmit` no longer descends into our
  source and no longer sees the ~200 "errors from inside the SDK" the
  customer reported.
- **CI**: added `.github/workflows/ci.yml` with two jobs — `test`
  (typecheck, jest, build) and `consumer-smoke` (`npm pack` → install
  the tarball into a temp consumer fixture → run `tsc --noEmit` against
  `import { Chat, XmppProvider }`). This catches the ship-raw-source
  class of regression before publish.

#### Runtime crashes / red screens

- **`addRoomViaApi` crashed on the new-arch path** — the function was
  imported in `useGetNewArchRoom`, `AddMembersModal`, `UserProfileModal`,
  and `NewChatModal` but never existed in `roomsSlice`. Added as a
  `createAsyncThunk` that dispatches `addRoomFromApi`. Consumers can now
  set `newArch: true` instead of the previous `newArch: false`
  workaround.
- **`api.config` import in `apiClient.ts`** referenced a file outside
  the published tarball (`../../api.config`), breaking on every fresh
  install. Removed the import; default app token is an empty string —
  consumers set it via `customAppToken` in the config or `setBaseURL`.
- **Unhandled promise rejections** from `getRoomsStanza` / `getHistoryStanza`
  `.then()` chains with no `.catch()` — these surfaced as red-screen
  errors that the customer was suppressing with `LogBox.ignoreLogs`.
  Added `.catch` handlers in `ChatWrapper` (three call sites) and
  `ThreadWrapper`.
- **`onGetMembers` wiped REST-loaded members** by dispatching an empty
  `roomMembers: []` whenever a quiet room's IQ stanza arrived without
  activities. Now early-returns on empty activities and merges with
  existing per-jid members instead of replacing.

#### Keyboard

- **iOS chat input didn't lift on focus** — `KeyboardAvoidingView` from
  `react-native-keyboard-controller` was used inside `ChatRoom`, but the
  required `<KeyboardProvider>` root wrapper was never mounted, so the
  controller silently fell back to a no-op. Mounted `<KeyboardProvider>`
  at the chat root in `ReduxWrapper`. Consumers can drop their RN stock
  `KeyboardAvoidingView` wrapper workaround.
- **Android keyboard flicker** — `behavior="padding"` on Android
  collided with the manifest's native `adjustResize`. Switched to
  platform-aware `behavior={Platform.OS === 'ios' ? 'padding' : 'height'}`.

#### Media (receive)

- **Receiving audio is now playable** — `AudioMessage` previously
  rendered an empty `ScrollView` because the fetch/decode pipeline was
  commented out and amplitudes were never populated. Rewritten with
  `expo-av` `Audio.Sound`, play/pause control, progress bar, and
  duration display.
- **Receiving video is now playable** — `VideoMessage` previously bound
  `onBuffer={handleOpen}` which re-opened the preview modal in a loop;
  the play/pause toggle called `seek(0)` instead of toggling `paused`.
  Rewritten with `expo-av` `Video` + `useNativeControls`.
- **Receiving documents now renders the download tile** — the
  `application/octet-stream` mime (the default many backends use for
  arbitrary binaries: PDF, DOCX, archives) was routed to the broken
  `AudioMessage` branch in `MediaMessage`. Now falls through to
  `FileDownload` for non-audio extensions and only routes to audio when
  the filename actually carries `.mp3 / .m4a / .wav / .aac / .ogg / .flac`.

#### Media (send)

- **Camera now captures both photos and videos** (was photos-only).
- **Gallery picker accepts both photos and videos** (verified
  end-to-end: gallery → file preview → upload → XMPP stanza).
- Migrated both pickers from the deprecated
  `ImagePicker.MediaTypeOptions.All` enum to the new
  `mediaTypes: ['images', 'videos']` array syntax.

#### Layout / cosmetics

- **`MediaModal` stray semicolon** after `</View>` inside `<Modal>` —
  the `;` parsed as a text child of `Modal`, sibling to the wrapping
  View, breaking flex layout. Removed. Consumers can drop their local
  patch.

#### Type safety

- All previously-flagged `tsc --noEmit` errors are resolved (`EXIT 0`).
- Replaced 4 `as any` casts in `stanzaHandlers.ts` with proper `Element`
  / `RoomMember` / `Partial<DataXml>` typing.
- Exported previously-internal state types (`ChatState`,
  `RoomMessagesState`, `roomHeapSliceState`, `ButtonProps`) so
  declaration emission can name them.
- RTK slices now carry explicit `Slice<State, typeof reducers, Name>`
  annotations with `WritableDraft<State>` reducer params to prevent tsc
  from inlining immer's internal `WritableNonArrayDraft` into the
  emitted `.d.ts` (TS4023).
- Added ambient declarations for `expo-av` and `expo-media-library` so
  consumers without those packages still get a clean type-check.
- `roomsSlice.ts` switched its `XmppClient` reference from the
  baseUrl-rooted `'src/networking/xmppClient'` to a type-only relative
  `'../networking/xmppClient'`.

### Added

- [`docs/unread-tracking.md`](docs/unread-tracking.md) — `useUnread`
  hook, count-computation rules, XMPP private-store persistence,
  `disableLastRead` opt-out, and the file map.
