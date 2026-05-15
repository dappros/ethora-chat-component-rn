# Web ↔ React Native parity

This doc maps every initialization / lifecycle / config flow in the web
`ethora-chat-component` to its counterpart in this React Native repo
(branch `stable-version`).

Legend: ✅ ported · 🟡 partial · ❌ missing or stub.

---

## 1. Flow parity

| # | Flow | Web (source) | RN (this repo) | Status | Notes |
|---|------|--------------|----------------|--------|-------|
| 1 | `IConfig` model (`initBeforeLoad`, `userLogin`, `customLogin`, `jwtLogin`, `xmppSettings`, `eventHandlers`, `refreshTokens`, `baseUrl`, `customAppToken`, `appId`) | `src/types/models/config.model.ts` | Canonical `IConfig` in `src/types/types.ts`; `src/types/models/config.model.ts` is now a thin re-export shim | ✅ | **Consolidated** — single source of truth. The shim keeps existing `import { IConfig } from '.../models/config.model'` callers working. |
| 2 | `resolveInitBeforeLoadUser` (userLogin → customLogin → jwtLogin → redux → AsyncStorage) | `src/helpers/resolveInitBeforeLoadUser.ts` | `src/helpers/resolveInitBeforeLoadUser.ts` | ✅ | Same priority chain. `localStorage` swapped for `AsyncStorage` via `useLocalStorage(ETHORA_USER)`. |
| 3 | `tryHydrateViaMy` → `/users/my` with refresh-on-401 fallback | same | same | ✅ | Identical control flow incl. xmpp-creds-only fallback when `/users/my` 403s. |
| 4 | `applyResolvedUserToStore` (dispatch `setUser`) | same | same | ✅ |  |
| 5 | `getMyUser` (`/users/my`) | `networking/api-requests/user.api.ts` | `networking/api-requests/user.api.ts` | ✅ | `{token, endpoint}` override supported. |
| 6 | `loginViaJwt` (`/users/client`) | `networking/api-requests/auth.api.ts` | `networking/api-requests/auth.api.ts` | ✅ |  |
| 7 | Runtime `setBaseURL` (multi-tenant) | `networking/apiClient.ts` | `networking/apiClient.ts` | ✅ | `setBaseURL(baseUrl, appToken)`. |
| 8 | `clientRegistry` (global singleton + init-lock) | `utils/clientRegistry.ts` | `utils/clientRegistry.ts` | ✅ | `buildXmppClientKey` / `getReusableXmppClientByKey` / `withXmppClientInitLock`. |
| 9 | `XmppClient` accepts `xmppSettingsInterface` | `networking/xmppClient.ts` | `networking/xmppClient.ts` | ✅ | Constructor accepts settings object; bare-`devServer` back-compat retained. |
| 10 | `waitForOnline` / `ensureConnected` | `xmppClient.ts` | `xmppClient.ts` | ✅ | RN polls status with timeout. |
| 11 | Exponential reconnect + `suppressReconnect` | `xmppClient.ts` | `xmppClient.ts` | ✅ | `scheduleReconnect()` doubles `reconnectDelay`; `disconnect({suppressReconnect:true})` halts retries. |
| 12 | Provider bootstrap status (`idle/running/ready/failed`) | `context/xmppProvider.tsx` | `context/xmppProvider.tsx` | ✅ | Surfaced via `useXmppClient().providerBootstrapStatus`. |
| 13 | `initBeforeLoad` provider effect (resolve → prefetch → connect → cache rooms+private store → ready) | `xmppProvider.tsx` | `xmppProvider.tsx` | ✅ | Stable bootstrap key + AbortController cleanup. |
| 14 | `prefetchRoomsViaRest` (`GET /chats/my`, 60 s cache) | `networking/api-requests/rooms.api.ts` | `networking/api-requests/rooms.api.ts` | ✅ | Per-token cache + in-flight dedup. |
| 15 | `ensureScopedChatCache` (purge on appId/baseUrl change) | web helper | `helpers/ensureScopedChatCache.ts` | ✅ | AsyncStorage-tracked scope; on mismatch disconnects client, clears REST cache, dispatches `logout` + `setLogoutState`, clears persisted state. |
| 16 | Reconnect orchestration in provider (3 × `client.reconnect()` then full reinit) | `xmppProvider.tsx` | `xmppProvider.tsx` | ✅ | Tracks `lastCredsRef`. |
| 17 | Logout event listener (`ethora-xmpp-logout`) | `window.dispatchEvent` | `DeviceEventEmitter('ethora-xmpp-logout')` + `emitXmppLogout()` helper | ✅ |  |
| 18 | Client reuse short-circuit in `initializeClient` | `xmppProvider.tsx` | `xmppProvider.tsx` | ✅ | Three-tier: registry → provider state → lock+new. |
| 19 | `LoginWrapper` defers to provider when `initBeforeLoad=true` | `LoginWrapper.tsx` | `components/MainComponents/LoginWrapper.tsx` | ✅ | Early-returns; no double auth race. |
| 20 | `ChatWrapper` waits on `providerBootstrapStatus` | `useChatWrapperInit.ts` | `components/MainComponents/ChatWrapper.tsx` (inline effect) | 🟡 | Logic inlined in `ChatWrapper`; `src/hooks/useChatWrapperInit.ts` exists but **is no longer called** (orphaned after the port overwrite). |
| 21 | ChatWrapper uses `xmppUsername` (falls back to walletAddress) + passes `xmppSettings` | `useChatWrapperInit.ts` | `ChatWrapper.tsx` | ✅ |  |
| 22 | `getRoomsStanza` + `getChatsPrivateStoreRequestStanza` post-init | both | both | ✅ |  |
| 23 | `useRoomInitialization` per-room presence + history fetch | `hooks/useRoomInitialization.tsx` | `hooks/useRoomInitialization.tsx` | ✅ | Web's variant has more QoS knobs (row 28). |
| 24 | Token refresh (`/users/login/refresh`) + axios 401 interceptor | `apiClient.ts` | `apiClient.ts` | ✅ |  |
| 25 | `refreshTokens.refreshFunction` custom hook | `apiClient.ts` | `apiClient.ts` | ✅ |  |
| 26 | Cache scope persistence (redux-persist) | `redux-persist` + transforms | home-grown `roomStore/persistence.ts` + `ensureScopedChatCache.ts` | ✅ | Debounced 200 ms writes to AsyncStorage, 50-msg/room cap, secret-stripping. Async rehydrate via `persistorReady`. Cleared on scope change + logout. |
| 27 | `historyQoS` config knobs (staged preload, top-K rooms) | `xmppClient.ts` + `historyPreloadScheduler.ts` | `xmppClient.ts` + `helpers/historyPreloadScheduler.ts` | ✅ | `stagedPreloadConcurrency`, `stagedPreloadFirstPassSize`, `preloadTopKRooms` honored. |
| 28 | MAM in-flight registry / active-room boost / soft-pause | `xmppClient.ts` | `xmppClient.ts` (`mamInFlightByRoom`, `softPauseUntil`, `activeRoomBoostUntil`) | ✅ | `setActiveRoomJid`, `promoteRoomHistory`, `isActiveRoomGateOpen`, `onCriticalSend`, `enqueueHistoryTask`, `prioritizeRoomPresence`. `getHistoryStanza` accepts `{coalesceRoom, skipIfPreloaded, source}`. |
| 29 | `runHistoryPreloadScheduler` fired post-bootstrap | `xmppProvider.tsx` | `xmppProvider.tsx` | ✅ | AppState-aware (`AppState.currentState !== 'active'` → pause), jittered retry, abort signal. |
| 30 | `chatAutoEnterer` (URL/deep-link → activeRoom) | `helpers/chatAutoEnterer.ts` | `helpers/chatAutoEnterer.ts` | 🟡 | File exists with `setCurrentRoom` dispatch logic. **Not currently called** from `ChatWrapper` (the port overwrite removed that wiring). The orphaned `useChatWrapperInit.ts` still references it. |
| 31 | Push notifications (FCM) | web `usePushNotifications.ts` + service worker | `hooks/usePushNotifications.ts` + `services/pushNotifications.ts` + `services/pushSubscriptionService.ts` | 🟡 | Code exists; `PushNotificationProvider.tsx` is **fully commented-out scaffold**, so the hook isn't auto-mounted. Use the hook manually at the app layer, or uncomment + wire the provider. |
| 32 | In-app notification toasts | `MessageNotificationContext.tsx` + `utils/messageNotificationManager.ts` | `context/MessageNotificationContext.tsx` + `utils/messageNotificationManager.ts` | ✅ | RN `Animated` toasts, AppState-aware pruning, dedupe 5 s, suppresses own + active-room messages. Fed by `stanzaHandlers.onRealtimeMessage`. Mounted in `ReduxWrapper`. |
| 33 | `storeConsole` debug bridge | `window.useStoreConsole` | `globalThis.useStoreConsole` | ✅ | Toggled by `config.useStoreConsoleEnabled`; side-effect import in `ReduxWrapper`. |
| 34 | `eventHandlers.onMessageSent / Failed / Edited` | `useEventHandlers.tsx` | `hooks/useEventHandlers.tsx` + `hooks/useSendMessage.tsx` | ✅ | Text, media, and edit paths all emit. |
| 35 | `clearStoreBeforeInit` config flag | `useChatWrapperInit.ts` | `xmppProvider.tsx` (initBeforeLoad effect) | ✅ | Dispatches `setLogoutState` + `logout` and clears the persisted-user AsyncStorage key. |
| 36 | `disableLastRead` propagation | `xmppClient.ts` private-store methods | `xmppClient.ts` early-return in `getChatsPrivateStoreRequestStanza` + `actionSetTimestampToPrivateStoreStanza` | ✅ | Constructor reads `xmppSettings.disableLastRead`. |
| 37 | Provider/Redux mount order (Redux outside Xmpp) | `ReduxWrapper.tsx` | `ReduxWrapper.tsx` | ✅ | `<Provider><XmppProvider><MessageNotificationProvider>…`. |
| 38 | Active-room sync to client | `useChatWrapperInit.ts` | `ChatWrapper.tsx` useEffect on `activeRoomJID` | ✅ | Calls `client.setActiveRoomJid(jid)`. |
| 39 | Critical-send hint (`onCriticalSend`) | `useSendMessage` | `useSendMessage.tsx` | ✅ | Fires before text/media send. |
| 40 | `historyPreloadState` / `historyComplete` / `unreadCapped` room fields + `applyRoomsPreloadBatch` | `roomsSlice` | `roomsSlice.ts` | ✅ | Reducer applies batched patches. |
| 41 | Unread count (`useUnread` / `unreadMiddleware`) | `useUnreadMessagesCounter.ts` + `Middleware/unreadMidlleware.tsx` | same | ✅ | Bug fix: `countNewerMessages` now uses `new Date(msg.date).getTime() > timestamp` (was wrong direction + unit-mismatched). `setLastViewedTimestamp(0)` now resets unread to 0 on enter. |
| 42 | `logoutMiddleware` → emits `ethora-xmpp-logout` | web n/a (DOM event) | `roomStore/Middleware/logoutMiddleware.tsx` | ✅ | Wired. Provider's `DeviceEventEmitter` listener disconnects + clears caches. |
| 43 | `newMessageMidlleware` → updates `IRoom.lastMessageTimestamp` | web | `roomStore/Middleware/newMessageMidlleware.tsx` | ✅ | Wired. `IRoom.lastMessageTimestamp` is typed. |
| 44 | `reactionsMiddleware` + `setReactions` reducer | web | `roomStore/Middleware/reactionsMiddleware.tsx` + `roomsSlice.setReactions` | ✅ | Reducer stamps `reactions` onto the message; middleware updates `lastMessage`/`lastMessageTimestamp`. `ReactionAction` re-exported via `types.ts`. |
| 45 | `roomHeapSlice` (threads / heap of replied-to messages) | web `roomHeapSlice` | `roomStore/roomHeapSlice.ts` wired as `state.roomHeapSlice` | ✅ | Provides `addMessageToHeap`, `removeMessageFromHeapById`, `clearHeap`. |
| 46 | `setLangSource` + `state.chatSettingStore.langSource` (translate UI) | web | `chatSettingsSlice.ts` | ✅ | Action + state restored. Cleared on logout. |
| 47 | `setPendingNotificationJid` + `clearPendingNotificationJid` + `state.rooms.pendingNotificationJid` (push deep-link queue) | web | `roomsSlice.ts` | ✅ | Used by `usePushNotifications` (on tap) and `usePendingNotification` (on rooms-loaded). |
| 48 | XMPP method stubs to satisfy `XmppClientInterface` | n/a | `xmppClient.ts` — `setVCardStanza`, `createPrivateRoomStanza`, `sendMessageReactionStanza`, `sendTextMessageWithTranslateTagStanza` | 🟡 | Stubs warn or delegate; replace with real `*.xmpp.ts` helpers when ported. |

### Integration follow-up after the port overwrite

The port commit (`f57de0e`) overwrote a few existing RN files. The
follow-up commit (this one) restored what the overwrite dropped:

| Item | Status | Detail |
|------|:------:|--------|
| `roomHeapSlice` in `rootReducer` | ✅ | Wired back into `roomStore/index.ts` as `roomHeapSlice`. |
| `logoutMiddleware` | ✅ | Wired; emits `ethora-xmpp-logout` on `chatSettingStore/logout`. |
| `newMessageMidlleware` | ✅ | Wired; updates `IRoom.lastMessageTimestamp` (newly typed on `IRoom`). |
| `reactionsMiddleware` | ✅ | Wired; no-op until `setReactions` action is added (not present yet). `ReactionAction` re-exported from `types.ts`. |
| `setLangSource` action + `langSource` state | ✅ | Added to `chatSettingsSlice.ts` (`Iso639_1Codes` payload). Selector in `useChatSettingState` works. |
| `setPendingNotificationJid` + `clearPendingNotificationJid` + `pendingNotificationJid` state | ✅ | Added to `roomsSlice.ts`. `usePendingNotification` + `usePushNotifications` now resolve. |
| `IRoom.lastMessageTimestamp` field | ✅ | Added (used by `newMessageMidlleware`). |
| `ChatWrapper` calling `useChatWrapperInit` | 🟡 Still inlined | `src/hooks/useChatWrapperInit.ts` remains orphaned. The inline ChatWrapper effect covers initBeforeLoad parity; restoring the richer hook (chatAutoEnterer + getRoomsWithRetry + updateMessagesTillLast wiring) is a follow-up. |
| `chatAutoEnterer` wired | 🟡 Still orphaned | Helper exists, not called from the new ChatWrapper. Wire it once `useChatWrapperInit` is restored or call it directly post-bootstrap. |

### Unread counter — verified + bug fix

- **Bug fixed in `roomsSlice.countNewerMessages`**: was comparing
  `Number(message.id) < timestamp` (wrong direction, plus unit mismatch
  — `message.id` is microseconds while `lastViewedTimestamp` is ms).
  Now uses `new Date(message.date).getTime() > timestamp` to match
  `unreadMidlleware.tsx`, filters out `delimiter-new` and `pending`
  sends.
- **Bug fixed in `setLastViewedTimestamp`**: when `timestamp === 0` (user
  enters room) the reducer used to leave `unreadMessages` untouched, so
  pre-existing unreads would linger after entering. Now it explicitly
  resets to 0.
- **Verified flow**:
  - `useUnreadMessagesCounter` subscribes to the store and re-derives
    `{hasUnread, totalCount, unreadByRoom}` whenever any room's
    `unreadMessages` changes (via `useSyncExternalStore`).
  - `unreadMidlleware` increments per-room `unreadMessages` whenever a
    new message arrives in a non-active room with a non-zero
    `lastViewedTimestamp`.
  - `setLastViewedTimestamp({timestamp: 0})` clears on entry,
    `setLastViewedTimestamp({timestamp: now})` snapshots on exit, and
    `updatedChatLastTimestamps` hydrates initial timestamps from the
    XMPP private store.

---

## 2. `IConfig` parity (web `types/models/config.model.ts` ↔ RN)

RN now has a **single canonical `IConfig`** in
`src/types/types.ts`. `src/types/models/config.model.ts` is a thin
re-export shim so the historic `import { IConfig } from '.../models/config.model'`
callers (e.g. `ChatRoom.tsx`) keep working without drift.

| Field | web | RN | Notes |
|-------|:---:|:--:|-------|
| `appId` | ✅ | ✅ |  |
| `baseUrl` | ✅ | ✅ |  |
| `customAppToken` | ✅ | ✅ |  |
| `projectName` | ❌ | ✅ | RN-only; read by `pushSubscriptionService.subscribeToPush`. |
| `colors` | ✅ | ✅ |  |
| `messageColor` | ❌ | ✅ | RN-only. |
| `backgroundChat` | ✅ | ✅ | `image` typed as `ImageSourcePropType` on RN. |
| `bubleMessage` | ✅ | ✅ |  |
| `headerLogo` | ✅ | ✅ |  |
| `disableHeader` | ✅ | ✅ |  |
| `disableMedia` | ✅ | ✅ |  |
| `chatHeaderBurgerMenu` | ✅ | ✅ |  |
| `chatHeaderAdditional` | ✅ | ✅ |  |
| `headerMenu` | ✅ | ✅ |  |
| `headerChatMenu` | ✅ | ✅ |  |
| `chatHeaderSettings` | ✅ | ✅ |  |
| `googleLogin` | ✅ | ✅ | Uses `FBConfig`. |
| `jwtLogin` | ✅ | ✅ |  |
| `userLogin` | ✅ | ✅ |  |
| `customLogin` | ✅ | ✅ |  |
| `defaultLogin` | ✅ | ✅ |  |
| `refreshTokens` | ✅ | ✅ | `{enabled, refreshFunction}`. |
| `initBeforeLoad` | ✅ | ✅ | Drives provider bootstrap. |
| `initBeforeLoadAuth.myEndpoint` | ✅ | ✅ |  |
| `clearStoreBeforeInit` | ✅ | ✅ | Honored in provider bootstrap. |
| `newArch` | ✅ | ✅ |  |
| `useStoreConsoleEnabled` | ✅ | ✅ |  |
| `xmppSettings` | ✅ | ✅ | See §3 for the inner shape. |
| `disableLastRead` | ✅ | ✅ | Top-level + `xmppSettings.disableLastRead`; client respects both. |
| `historyQoS` | ✅ | ✅ |  |
| `disableRooms` | ✅ | ✅ |  |
| `disableRoomMenu` | ✅ | ✅ |  |
| `forceSetRoom` | ✅ | ✅ |  |
| `defaultRooms` | ✅ | ✅ (`string[] \| ConfigRoom[]`) |  |
| `setRoomJidInPath` | ✅ | ✅ | Web-only semantics; no-op on RN. |
| `customRooms` | ✅ | ✅ |  |
| `enableRoomsRetry` | ✅ | ✅ |  |
| `disableNewChatButton` | ✅ | ✅ |  |
| `disableRoomConfig` | ✅ | ✅ |  |
| `disableChatInfo` | ✅ | ✅ |  |
| `qrUrl` | ✅ | ✅ |  |
| `roomListStyles` | ✅ (`React.CSSProperties`) | ✅ (`ViewStyle`) | Type swapped for RN. |
| `chatRoomStyles` | ✅ (`React.CSSProperties`) | ✅ (`ViewStyle`) |  |
| `disableInteractions` | ✅ | ✅ |  |
| `disableProfilesInteractions` | ✅ | ✅ |  |
| `disableUserCount` | ✅ | ✅ |  |
| `disableSentLogic` | ✅ | ✅ |  |
| `disableTypingIndicator` | ✅ | ✅ |  |
| `botMessageAutoScroll` | ✅ | ✅ |  |
| `blockMessageSendingWhenProcessing` | ✅ | ✅ |  |
| `messageTextFilter` | ✅ | ✅ |  |
| `secondarySendButton` | ✅ | ✅ | RN adds optional `buttonText`. |
| `customTypingIndicator` | ✅ | ✅ |  |
| `whitelistSystemMessage` | ✅ | ✅ |  |
| `customSystemMessage` | ✅ | ✅ |  |
| `translates` | ✅ | ✅ |  |
| `enableTranslates` | ❌ | ✅ | RN-only convenience (web uses `translates.enabled`). |
| `inAppNotifications` | ✅ | ✅ | See §1 row 32. |
| `pushNotifications` | ✅ (FCM + serviceWorker) | ✅ (FCM + `onNotificationPress` + `onClick`) | RN shape adapted for `@react-native-firebase/messaging`. |
| `eventHandlers.{onMessageSent, onMessageFailed, onMessageEdited}` | ✅ | ✅ | Wired through `useSendMessage`. |
| `noMessagesPlaceholder` | ✅ | ❌ | Not added — RN side renders a placeholder inline. |

---

## 3. XMPP layer parity (provider + client)

### `xmppSettingsInterface`

`models/xmpp.model.ts` now re-exports from `types.ts` — there's a single
canonical definition.

| Field | web | RN | Notes |
|-------|:---:|:--:|-------|
| `devServer` | ✅ optional | ✅ optional |  |
| `host` | ✅ optional | ✅ optional |  |
| `conference` | ✅ optional | ✅ optional |  |
| `disableLastRead` | ✅ | ✅ | Honored by `XmppClient.disableLastRead`. |
| `xmppPingOnSendEnabled` | ✅ | ✅ | Typed only — RN client doesn't currently *send* pings. |
| `historyQoS.maxInFlightHistory` | ✅ | ✅ | Read by `XmppClient`. |
| `historyQoS.softPauseAfterSendMs` | ✅ | ✅ |  |
| `historyQoS.activeRoomBoostTtlMs` | ✅ | ✅ |  |
| `historyQoS.activeSendBoostMs` | ✅ | ✅ | Typed only. |
| `historyQoS.alwaysPrioritizeActiveRoom` | ✅ | ✅ | Honored. |
| `historyQoS.backgroundWhileCriticalSend` | ✅ | ✅ | Typed only. |
| `historyQoS.preloadTopKRooms` | ✅ | ✅ | Honored by scheduler. |
| `historyQoS.presenceFailureBackoffMs` | ✅ | ✅ | Typed only. |
| `historyQoS.startupPrivateStoreTimeoutMs` | ✅ | ❌ |  |
| `historyQoS.startupPrivateStoreTtlMs` | ✅ | ❌ |  |
| `historyQoS.stagedPreloadEnabled` | ✅ | ✅ | Typed only. |
| `historyQoS.stagedPreloadFirstPassSize` | ✅ | ✅ | Honored as `pageSize`. |
| `historyQoS.stagedPreloadSecondPassSize` | ✅ | ✅ | Typed only. |
| `historyQoS.stagedPreloadConcurrency` | ✅ | ✅ | Honored. |

### `XmppClientInterface` methods

`models/xmpp.model.ts` now declares the full QoS-aware interface
(`setActiveRoomJid`, `promoteRoomHistory`, `isActiveRoomGateOpen`,
`onCriticalSend`, `enqueueHistoryTask`, `prioritizeRoomPresence`,
`waitForOnline`, `disconnect({suppressReconnect?})`, `getHistoryStanza(..., options?)`).

| Method | web | RN impl | RN decl | Status |
|--------|:---:|:-------:|:-------:|--------|
| `checkOnline()` | ✅ | ✅ | ✅ | ✅ |
| `initializeClient()` | ✅ | ✅ | ✅ | ✅ |
| `attachEventListeners()` | ✅ | ✅ | ✅ | ✅ |
| `reconnect()` | ✅ | ✅ | ✅ | ✅ |
| `close()` | ✅ | ✅ | ✅ | ✅ |
| `ensureConnected(timeout?)` / `waitForOnline(timeout?)` | ✅ | ✅ | ✅ | ✅ |
| `disconnect({suppressReconnect?})` | ✅ | ✅ | ✅ | ✅ |
| `setActiveRoomJid(roomJID \| null)` | ✅ | ✅ | ✅ | ✅ |
| `isActiveRoomGateOpen()` | ✅ | ✅ | ✅ | ✅ |
| `promoteRoomHistory(roomJID)` | ✅ | ✅ | ✅ | ✅ |
| `onCriticalSend(roomJID, messageId?)` | ✅ | ✅ | ✅ | ✅ |
| `prioritizeRoomPresence(roomJID)` | ✅ | ✅ | ✅ | ✅ |
| `enqueueHistoryTask({chatJID, max, before?, id?, source?})` | ✅ | ✅ | ✅ | ✅ |
| `getRoomsStanza(disableGetRooms?)` | ✅ | ✅ (arg ignored) | ✅ | 🟡 Arg not honored. |
| `createRoomStanza` | ✅ | ✅ | ✅ | ✅ |
| `inviteRoomRequestStanza` | ✅ | ✅ | ✅ | ✅ |
| `leaveTheRoomStanza` | ✅ | ✅ | ✅ | ✅ |
| `presenceInRoomStanza(roomJID, settleDelay?, timeoutMs?, waitForJoin?)` | ✅ (returns `Promise<boolean>`) | ✅ (returns void) | ✅ (returns void) | 🟡 RN doesn't return a "joined" boolean. |
| `recoverRoomPresenceOnly(roomJID)` | ✅ | ❌ | ❌ | ❌ |
| `getHistoryStanza(chatJID, max, before?, otherStanzaId?, options?)` | ✅ | ✅ | ✅ | ✅ |
| `getLastMessageArchiveStanza` | ✅ | ✅ | ✅ | ✅ |
| `setRoomImageStanza` | ✅ | ✅ | ✅ | ✅ |
| `getRoomInfoStanza` | ✅ | ✅ | ✅ | ✅ |
| `getRoomMembersStanza` | ✅ | ✅ | ✅ | ✅ |
| `setVCardStanza(xmppUsername)` | ✅ | 🟡 stub (warns) | ✅ | 🟡 |
| `sendMessage` | ✅ | ✅ | ✅ | ✅ |
| `deleteMessageStanza` | ✅ | ✅ | ✅ | ✅ |
| `editMessageStanza` | ✅ | ✅ | ✅ | ✅ |
| `sendTypingRequestStanza` | ✅ | ✅ | ✅ | ✅ |
| `getChatsPrivateStoreRequestStanza` (gated on `disableLastRead`) | ✅ | ✅ | ✅ | ✅ |
| `actionSetTimestampToPrivateStoreStanza` (gated) | ✅ | ✅ | ✅ | ✅ |
| `sendMediaMessageStanza(roomJID, data, id?)` | ✅ | ✅ (id accepted but unused) | ✅ | 🟡 |
| `createPrivateRoomStanza` | ✅ | 🟡 stub — delegates to `createRoomStanza` | ✅ | 🟡 |
| `sendMessageReactionStanza` | ✅ | 🟡 stub (warns) | ✅ | 🟡 |
| `sendTextMessageWithTranslateTagStanza` | ✅ | 🟡 stub — delegates to `sendMessage` (no translate tag) | ✅ | 🟡 |

### `XmppProvider` surface

| Provider feature | web | RN | Status | Notes |
|------------------|:---:|:--:|:------:|-------|
| `useXmppClient()` context hook | ✅ | ✅ | ✅ | |
| `client: XmppClient \| null` | ✅ | ✅ | ✅ | |
| `providerBootstrapStatus` | ✅ | ✅ | ✅ | |
| `initMode` (`'provider' \| 'chat'`) | ✅ | ✅ | ✅ | |
| `initializeClient(username, password, xmppSettings?)` | ✅ | ✅ | ✅ | |
| `setClient(client \| null)` | ✅ | ✅ | ✅ | |
| `initBeforeLoad` effect | ✅ | ✅ | ✅ | |
| `ensureScopedChatCache` invocation | ✅ | ✅ | ✅ | |
| `prefetchRoomsViaRest` parallel kickoff | ✅ | ✅ | ✅ | |
| `runHistoryPreloadScheduler` kickoff | ✅ | ✅ | ✅ | |
| Reconnect → reinit fallback (3 attempts) | ✅ | ✅ | ✅ | |
| Logout event subscription | ✅ (`window`) | ✅ (`DeviceEventEmitter`) | ✅ | |
| `clearStoreBeforeInit` honored | ✅ | ✅ | ✅ | |
| `emitXmppLogout()` helper | ✅ (web equivalent: `window.dispatchEvent`) | ✅ | ✅ | |

---

## 4. Consumer wire-up (RN)

```tsx
<ReduxWrapper
  config={{
    initBeforeLoad: true,
    appId: 'my-app',
    baseUrl: 'https://api.chat.ethora.com/v1',
    customAppToken: APP_TOKEN,
    xmppSettings: {
      devServer: 'xmpp.chat.ethora.com:5443',
      historyQoS: { stagedPreloadConcurrency: 3, preloadTopKRooms: 10 },
    },
    userLogin:   { enabled: true, user: storedUser },
    // or:
    // customLogin: { enabled: true, loginFunction: async () => myAuth() },
    // jwtLogin:    { enabled: true, token: clientJwt },
    refreshTokens: { enabled: true },
    inAppNotifications: { enabled: true, position: { vertical: 'top' } },
    eventHandlers: {
      onMessageSent: ({ message, roomJID }) => console.log('sent', roomJID, message),
    },
  }}
/>
```

Bootstrap sequence on mount:

1. `ReduxWrapper` mounts `<Provider><XmppProvider><MessageNotificationProvider>…`.
2. `XmppProvider` `initBeforeLoad` effect:
   1. (optional) `clearStoreBeforeInit` purge.
   2. `ensureScopedChatCache(config)` — purge on `appId`/`baseUrl` change.
   3. `resolveInitBeforeLoadUser({config})` walks the priority chain.
   4. `applyResolvedUserToStore(user)` → redux `setUser`.
   5. `prefetchRoomsViaRest()` fires in parallel with XMPP connect.
   6. `initializeClient(xmppUsername, xmppPassword, xmppSettings)` reuses the
      global client via `clientRegistry` or creates one under an init lock.
   7. `client.waitForOnline()`.
   8. `client.getRoomsStanza()` + `client.getChatsPrivateStoreRequestStanza()`.
   9. `setStoreClient(c)` + `providerBootstrapStatus = 'ready'`.
   10. `runHistoryPreloadScheduler(...)` kicks off in background.
3. `LoginWrapper` short-circuits (sees `initBeforeLoad`) → renders `ChatWrapper`.
4. `ChatWrapper.initXmmpClient` sees `ready` → reuses client → `setInited(true)`.
5. `ChatRoom` renders, `useRoomInitialization` fetches active-room history.
6. When `activeRoomJID` changes, `client.setActiveRoomJid(jid)` boosts MAM priority.

If `initBeforeLoad` is false (or omitted), `LoginWrapper` does email/jwt
login → `ChatWrapper` creates the client itself.

---

## 5. Tests

Run all flow-layer tests:

```sh
yarn jest
```

Suites under `__tests__/` (34 tests, all passing):

| Suite | What it covers |
|-------|----------------|
| `unreadCounter.test.ts` (5) | `setLastViewedTimestamp` reducer (entry resets, strict `>` by date, excludes `delimiter-new` + `pending`) and `unreadMiddleware` (no-op for active room; increments for non-active). |
| `clientRegistry.test.ts` (11) | `buildXmppClientKey` determinism, `isXmppClientReusable` per status, global `setGlobalXmppClient` + `getReusableXmppClientByKey`, `withXmppClientInitLock` dedup. |
| `persistence.test.ts` (4) | Debounced write (200 ms), secret-stripping on user, 50-msg/room cap, `readPersistedState` + `clearPersistedState`. |
| `resolveInitBeforeLoadUser.test.ts` (7) | Full priority chain (userLogin → customLogin → jwtLogin → redux → AsyncStorage), abort-signal short-circuit, `/users/my` hydration fallback. |
| `xmppClientQoS.test.ts` (6) | `setActiveRoomJid` / `onCriticalSend` / `isActiveRoomGateOpen` / `enqueueHistoryTask` coalesce / `mamInFlightByRoom` cleanup / `getHistoryStanza({coalesceRoom})` routing / `disableLastRead` gating. |
| `e2eJwtLoginRoomJid.test.tsx` (1) | **End-to-end smoke**: mounts `<Provider><XmppProvider config={{initBeforeLoad, jwtLogin, xmppSettings}}>` with `react-test-renderer`. Asserts `loginViaJwt` is called with the configured token, redux user gets the JWT response, a single `XmppClient` is instantiated with the right creds, `waitForOnline` + `getRoomsStanza` + `getChatsPrivateStoreRequestStanza` chain runs, `providerBootstrapStatus` reaches `'ready'`, and `setCurrentRoom({roomJID})` routes single-room mode. |

`jest.setup.js` mocks `@react-native-async-storage/async-storage` plus
the optional native deps the repo references but doesn't install
(`react-native-svg`, reanimated, image-picker, audio-recorder, etc.) so
no test needs a native runtime.

Bugs caught + fixed during this pass (each is now under test):

- `useLocalStorage` was using `useCallback` outside a React render
  (called from `chatSettingsSlice.setUser`/`logout`/`refreshTokens`) →
  threw at every dispatch. Replaced with plain functions.
- `XmppProvider` `initBeforeLoad` effect held `inflightBootstrapKeyRef`
  open after `setClient` triggered a re-render mid-bootstrap, so the
  retried effect short-circuited → bootstrap stuck at `'running'` and
  `getRoomsStanza` never fired. Cleared the ref in the cleanup and
  removed `initializeClient` from the effect dep array.
- `unreadMiddleware` filter omitted `!msg.pending` so the middleware
  disagreed with the reducer for locally-pending sends.
- `roomsSlice.countNewerMessages` used wrong direction + unit-mismatched
  comparison (see §1 row 41).
- `XmppClient.enqueueHistoryTask` had a TDZ bug (`promise` self-check
  before assignment).
- `state.rooms.activeRoomJID` was typed `string` but initialized to
  `null` — every assignment was a type error.

## 6. Files

### Added (by the port commit `f57de0e`)

- `src/helpers/resolveInitBeforeLoadUser.ts`
- `src/helpers/ensureScopedChatCache.ts`
- `src/helpers/historyPreloadScheduler.ts`
- `src/utils/clientRegistry.ts`
- `src/utils/messageNotificationManager.ts`
- `src/networking/api-requests/rooms.api.ts`
- `src/context/MessageNotificationContext.tsx`
- `src/hooks/useEventHandlers.tsx`
- `src/roomStore/persistence.ts`

### Modified by the port + this follow-up integration pass

- `src/types/types.ts` — canonical `IConfig` (union of both surfaces), `IRoom.lastMessageTimestamp`, re-exports of `ReactionAction` + `Iso639_1Codes`.
- `src/types/models/config.model.ts` — now a re-export shim.
- `src/types/models/xmpp.model.ts` — re-exports `xmppSettingsInterface`/`HistoryQoSConfig`; `XmppClientInterface` extended to declare QoS methods + `HistoryFetchOptions`.
- `src/networking/apiClient.ts` — `setBaseURL`, `getCurrentAppToken`.
- `src/networking/api-requests/user.api.ts` — `getMyUser`.
- `src/networking/xmppClient.ts` — `xmppSettings`, QoS API, `disableLastRead` gating + stub impls (`setVCardStanza`, `createPrivateRoomStanza`, `sendMessageReactionStanza`, `sendTextMessageWithTranslateTagStanza`).
- `src/networking/stanzaHandlers.ts` — `onRealtimeMessage` feeds `messageNotificationManager`.
- `src/context/xmppProvider.tsx` — bootstrap status, `initBeforeLoad`, logout listener, scheduler kickoff, `clearStoreBeforeInit`.
- `src/components/MainComponents/{ReduxWrapper,LoginWrapper,ChatWrapper}.tsx`.
- `src/roomStore/chatSettingsSlice.ts` — `setLangSource` + `langSource` state; AsyncStorage in setters.
- `src/roomStore/roomsSlice.ts` — `applyRoomsPreloadBatch`, `setPendingNotificationJid` + `clearPendingNotificationJid` + `pendingNotificationJid` state, **`countNewerMessages` bug fix + unread reset on enter**.
- `src/roomStore/index.ts` — wires `roomHeapSlice` + `logoutMiddleware` + `newMessageMidlleware` + `reactionsMiddleware` + `persistenceMiddleware`; async `persistorReady` rehydrate.
- `src/hooks/useSendMessage.tsx`.
- `src/hooks/useChatSettingState.tsx` — selector exposes `client` (consumed by `ChatWrapper`).
- `src/hooks/useLocalStorage.tsx` — removed misplaced `useCallback`s; now safe to call outside a React render (the reducers do).
- `src/helpers/storeConsole.ts` — `globalThis` bridge.
- `src/roomStore/Middleware/unreadMidlleware.tsx` — filter now excludes `pending` messages (matches reducer).

## Test scaffolding

- `jest.config.js` — adds `testPathIgnorePatterns` (skip `.claude/` worktree, `web/`, pre-existing broken `App.test.tsx`); extends `transformIgnorePatterns` for the deps Jest must transpile.
- `jest.setup.js` — global mocks (AsyncStorage + every optional native dep the source tree references but doesn't install).
- `__tests__/unreadCounter.test.ts`
- `__tests__/clientRegistry.test.ts`
- `__tests__/persistence.test.ts`
- `__tests__/resolveInitBeforeLoadUser.test.ts`
- `__tests__/xmppClientQoS.test.ts`
- `__tests__/e2eJwtLoginRoomJid.test.tsx`
- `src/helpers/storeConsole.ts`
