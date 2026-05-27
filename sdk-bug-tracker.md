# Ethora RN SDK — Bug Tracker

Issues discovered during integration of `@ethora/chat-component-rn` into a React Native patient app (Expo 54, RN 0.81, New Architecture).

**Current SDK version under test:** `26.5.8` (patch addressing every 26.5.7 retest item + unread-tracking)

---

## Summary

- **5 issues fixed** in 26.5.5
- **2 issues fixed** in 26.5.7: #11 keyboard dismiss on scroll, #17 XMPP reconnect loop (both confirmed by integrator)
- **All remaining 10 items** addressed in **26.5.8** (this round, integrator retest pending): #10, #9, #4, #6, #13, #14, #18, #15, #16, plus the `useUnread` cold-start bug and a new scroll-to-bottom count badge
- **Only #5 (iOS KAV) remains intentionally deferred** per integrator's own note ("not a blocker, we are good if this does not get fixed")

---

## Index

| # | Issue | Description | Severity | Type | Version | Reported | Patched/Workaround | Fixed upstream |
| :---: | --- | --- | :---: | :---: | :---: | :---: | :---: | :---: |
| ~~1~~ | ~~MediaModal.tsx stray semicolon~~ | ~~Trailing `;` after `</View>` inside `<Modal>` renders as text node, crashes iOS app~~ | ~~Critical~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~No~~ | ~~Yes (26.5.5)~~ |
| ~~3~~ | ~~Missing `api.config` module~~ | ~~`apiClient.ts` imports `../../api.config` from demo app, not shipped in npm package — build crashes~~ | ~~Critical~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~Yes (shim)~~ | ~~Yes (26.5.5)~~ |
| ~~7~~ | ~~`addRoomViaApi` missing export~~ | ~~`roomsSlice` exports `addRoom` not `addRoomViaApi` — `syncRooms()` and 3 modals crash at runtime~~ | ~~Critical~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~Yes (newArch:false)~~ | ~~Yes (26.5.5)~~ |
| ~~2~~ | ~~stanzaHandlers.ts empty roomMembers~~ | ~~`onGetMembers` dispatches empty array on some XMPP events, wipes REST-loaded member list~~ | ~~High~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~No~~ | ~~Yes (26.5.5)~~ |
| ~~8~~ | ~~TypeScript errors (290)~~ | ~~Missing modules, wrong imports, mismatched types across SDK source~~ | ~~Low~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~Yes (type shim)~~ | ~~Yes (26.5.5)~~ |
| ~~9~~ | ~~Cannot view docs/video/audio~~ | ~~Video opens in 26.5.7 but in a small modal where controls are behind tab bar (not visible/controllable). Docs and audio still broken — preview is blank.~~ | ~~High~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~No~~ | ~~Yes (26.5.8: paddingBottom on video, AudioMessage case, **full inline preview for office docs via Google gview embed in WebView**)~~ |
| ~~10~~ | ~~Cannot send video or audio~~ | ~~Upload to `/files/` returns 500. SDK logs `upload failed {status: 500, requestUrl: '/files/'}` and fires `onMessageFailed` with `messageType: 'media'`. Sending images works — only video/audio/docs fail.~~ | ~~High~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~No~~ | ~~Yes (26.5.8: assets-library URI coerce + singular `file` retry)~~ |
| ~~4~~ | ~~Unhandled promise rejections~~ | ~~`.then()` without `.catch()` on XMPP methods causes red-screen errors in dev. Still seeing `Uncaught (in promise, id: 0)` and `(in promise, id: 2)` errors in 26.5.7.~~ | ~~High~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~Yes (LogBox)~~ | ~~Yes (26.5.8: ChatWrapper, usePushNotifications x2, **getRoomsPaged unawaited send (most likely id:0/id:2 root cause)**, presenceInRoom race, dev-only global rejection tracker)~~ |
| ~~6~~ | ~~Android message flicker~~ | ~~26.5.7 worsened — keyboard completely blocked chat input. Required host-app `KeyboardAvoidingView` with `behavior="padding"` workaround. Input now visible but message flicker remains on keyboard open.~~ | ~~Low~~ | ~~Bug~~ | ~~26.4.2~~ | ~~05-22~~ | ~~Yes (host-app KAV)~~ | ~~Yes (26.5.8: behavior="padding" on both platforms)~~ |
| ~~11~~ | ~~Keyboard dismiss on scroll~~ | ~~`handleScroll` calls `Keyboard.dismiss()` on every scroll event, FlatList missing persist-taps props~~ | ~~Medium~~ | ~~Bug~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.7)~~ |
| ~~17~~ | ~~XMPP reconnect loop after idle~~ | ~~After idle period, XMPP gets `StreamError: not-authorized`, retries with backoff, enters disconnect/reconnect loop. Likely JWT expiry — SDK reconnects with stale credentials instead of re-authenticating.~~ | ~~High~~ | ~~Bug~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.7)~~ |
| ~~18~~ | ~~Failed messages stuck in sending state~~ | ~~Error-path works in 26.5.7 but still broken when failure is silent (e.g. no internet) — message stays in "sending" state even after reconnecting.~~ | ~~Low~~ | ~~Bug~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.8: 30s watchdog → mark failed)~~ |
| ~~14~~ | ~~Delete confirmation full-screen~~ | ~~Slightly improved in 26.5.7 — modal is a few pixels from screen edges instead of fully edge-to-edge, but still not a small centered dialog.~~ | ~~Medium~~ | ~~Bug~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.8: height undefined + alignSelf center)~~ |
| ~~13~~ | ~~Context menu position too high~~ | ~~Overcorrected in 26.5.7 — menu now appears too far above the message. On last message, context menu renders way above instead of near the message.~~ | ~~Medium~~ | ~~Customization~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.8: MENU_HEIGHT 280→160 matches actual)~~ |
| ~~15~~ | ~~Burger menu not removable~~ | ~~`ChatHeader.tsx` — burger icon always renders when there's no back button. `chatHeaderBurgerMenu` config only controls the RoomList dropdown, not the icon itself. Same issue in 26.5.7. No config to hide just the icon.~~ | ~~Low~~ | ~~Customization~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.6, `disableChatHeaderBurgerMenuIcon` flag)~~ |
| ~~16~~ | ~~Member profile actions not granular~~ | ~~`disableProfilesInteractions: true` hides the entire profile section (always worked). But no granular config to hide only "Send message" and "Copy user ID" while keeping the profile visible. Same issue with burger menu actions.~~ | ~~Low~~ | ~~Customization~~ | ~~26.5.5~~ | ~~05-26~~ | ~~No~~ | ~~Yes (26.5.8: `hideMemberSendMessageAction` + `hideMemberCopyIdAction` per-action flags)~~ |
| 5 | iOS KeyboardAvoidingView broken | SDK's KAV doesn't lift chat input on iOS. Works well with our outer KAV workaround — not a blocker. | Low | Bug | 26.4.2 | 05-22 | Yes (outer KAV) | Deferred (not a blocker per reporter) |

---

## Open — Previously reported (05-22), retested in 26.5.7

### #9 — Cannot view docs/video/audio (High) — Not fixed in 26.5.7

**Video:** Now opens and plays in 26.5.7. However, the video opens in a small modal where the media controls (play/pause, scrubber, etc.) are positioned too far down — behind the tab bar, making them not visible and not controllable.

**Docs and audio:** Still broken. Preview is blank — same behavior as 26.5.5. The original download error (`ExpoMediaLibrary.createAssetAsync` → "Could not get the file's extension") likely still applies for docs/audio.

---

### #10 — Cannot send video or audio (High) — Same in 26.5.7

Upload to `/files/` returns 500:

```
upload failed {status: 500, requestUrl: '/files/'}
Message failed: {messageType: 'media', error: 'Request failed with status code 500'}
```

`useSendMessage.tsx:286` — sending **images works fine**, only video/audio/document uploads fail. Unchanged from 26.5.5.

---

### #4 — Unhandled promise rejections (High) — Same in 26.5.7

Still seeing red-screen errors in dev:

```
ERROR  [Error: Uncaught (in promise, id: 0) ] Uncaught (in promise, id: 0)
ERROR  [Error: Uncaught (in promise, id: 2) ] Uncaught (in promise, id: 2)
```

`useChatWrapperInit.ts` still has `.then()` without `.catch()` — unchanged from 26.5.5.

---

### #6 — Android keyboard flicker + input hidden (Low) — Worsened in 26.5.7

26.5.7 made the keyboard issue worse — keyboard was **completely blocking the chat input**, making it unusable. Required applying a separate host-app `KeyboardAvoidingView` with `behavior="padding"` to bring the input above the keyboard.

With the workaround applied, input is now visible, but the **message flicker on keyboard open remains** — all messages visibly jump/flash when the keyboard animates in.

---

## Found in 26.5.5, retested in 26.5.7

### ~~#11 — Keyboard dismiss on scroll (Medium) — Fixed in 26.5.7~~

~~`MessageList.tsx` — `handleScroll` calls `Keyboard.dismiss()` on every scroll event. Any touch on the message list closes the keyboard. FlatList is also missing `keyboardShouldPersistTaps` and `keyboardDismissMode` props.~~

---

### ~~#17 — XMPP reconnect loop after idle (High) — Fixed in 26.5.7~~

~~After an idle period, the XMPP connection got `StreamError: not-authorized` and entered a disconnect/reconnect loop. Fixed in 26.5.7.~~

---

### #18 — Failed messages stuck in sending state (Low) — Not fixed in 26.5.7

**Fixed path:** When a message fails with an explicit error (e.g. server returns error), the failure is now detected and reflected.

**Still broken:** When a message fails silently — for example, sending while offline (no internet) — the message stays stuck in "sending" state indefinitely. It does **not** recover even after the device reconnects to the internet. No failure indicator and no retry option in this scenario.

---

### #14 — Delete confirmation full-screen (Medium) — Not fixed in 26.5.7

Slightly improved — the modal is now a few pixels from the left and right screen edges instead of being fully edge-to-edge. However, it's still not the expected small centered confirmation dialog. The overlay still covers nearly the entire screen.

---

### #13 — Context menu position too high (Medium, Customization) — Not fixed in 26.5.7

Previously the menu appeared too far **below** the message. In 26.5.7 it was overcorrected — the menu now appears too far **above** the message. On the last message in the list, the context menu renders way above the message instead of adjacent to it.

---

### #15 — Burger menu icon not removable (Low, Customization) — Same in 26.5.7

`ChatHeader.tsx` — the burger icon always renders when there's no back button. `chatHeaderBurgerMenu` config only controls the RoomList dropdown, not the icon itself. `disableHeader` hides the entire header which is too aggressive. No config to hide just the icon. Same behavior in 26.5.7.

---

### #16 — Member profile actions not granular (Low, Customization) — Clarified in 26.5.7

**Correction from original report:** `config.disableProfilesInteractions: true` was always working — it hides the entire profile interaction section. The issue is that there's no **granular** control: the setting is all-or-nothing. We want to keep the profile section visible but hide specific actions ("Send message" and "Copy user ID") that aren't appropriate for a patient app. Same issue applies to the burger menu — the actions within it can't be individually toggled.

---

### #5 — iOS KeyboardAvoidingView (Low, workaround in place)

SDK's `react-native-keyboard-controller` KAV doesn't lift chat input on iOS. We've worked around it with an outer `KeyboardAvoidingView` wrapper — works well, not a blocker for us.

---

## Test Results (26.5.7)

| Category | Feature | 26.5.5 | 26.5.7 | Notes |
| --- | --- | :---: | :---: | --- |
| **Media** | Send photo from camera | Works | Works | |
| | Send photo from gallery | Works | Works | |
| | Send file (PDF) | Works | Works | |
| | Send video/audio | Not working | Not working | #10 — 500 on upload |
| | View video from practitioner | Not working | Not working | #9 — video opens but controls behind tab bar, not usable |
| | View docs/audio from practitioner | Not working | Not working | #9 — preview still blank |
| **History** | Message history loads | Works | Works | |
| | Scroll-to-load-more | Works | Works | |
| | Local persistence | Works | Works | |
| **Real-time** | Typing indicators | Works | Works | |
| | Message ordering | Works | Works | |
| **Network** | Auto-reconnect after idle | Not working | Works | #17 — fixed in 26.5.7 |
| | Token auto-refresh | Not working | Works | #17 — fixed in 26.5.7 |
| **Failed messages** | Failed indicator (with error) | Not working | Works | #18 — error-path fixed |
| | Failed indicator (no internet) | Not working | Not working | #18 — silent failures stuck |
| | Manual retry/delete | Not working | Not working | |
| **Advanced** | Edits | Works | Works | |
| | Deletes | Works | Works | |
| | Emoji | Works | Works | |
| **Text** | Link detection | Works | Works | |
| | Copy text | Works | Works | |
| | Long messages | Works | Works | |
| **Keyboard** | Scroll while keyboard open | Not working | Works | #11 — fixed in 26.5.7 |
| | Android keyboard + input | Not working | Workaround | #6 — host-app KAV applied, flicker remains |

---

## In progress

- **Logout / session cleanup** — XMPP disconnect, store teardown, token invalidation
- **Error handling** — network loss, XMPP disconnect, expired JWT, server errors
- **Retry mechanism** — reconnection and room re-join after transient failures
- **Unread badge count** — `useUnread` hook available, testing badge visibility on tab and new message indication when user is scrolled up
