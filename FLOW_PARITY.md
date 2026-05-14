# Web ↔ React Native flow parity

This table tracks every initialization / lifecycle flow that exists in the
web `ethora-chat-component` and shows the corresponding RN file in this
repo. "Parity" means the RN side now has the same conceptual flow; it does
**not** mean every QoS knob or DOM-specific feature has been ported.

Legend: ✅ ported · 🟡 partial · ❌ missing (out of scope for this pass).

| # | Flow | Web (source) | RN (this repo) | Status | Notes |
|---|------|-------------|----------------|--------|-------|
| 1 | `IConfig` model (`initBeforeLoad`, `userLogin`, `customLogin`, `jwtLogin`, `xmppSettings`, `eventHandlers`, `refreshTokens`, `baseUrl`, `customAppToken`, `appId`) | `src/types/models/config.model.ts` | `src/types/types.ts` (`IConfig`, `xmppSettingsInterface`, `ProviderBootstrapStatus`) | ✅ | RN now exposes the same login modes, init flags, xmppSettings & event handlers. |
| 2 | `resolveInitBeforeLoadUser` resolution chain (userLogin → customLogin → jwtLogin → store → persisted) | `src/helpers/resolveInitBeforeLoadUser.ts` | `src/helpers/resolveInitBeforeLoadUser.ts` | ✅ | Same priority chain. `localStorage` replaced with `AsyncStorage` (`useLocalStorage(ETHORA_USER)`). `/users/my` hydration + refresh fallback ported. |
| 3 | `tryHydrateViaMy` → `/users/my` with refresh-on-401 fallback | same file | same file | ✅ | Identical control flow incl. xmpp-creds-only fallback when `/users/my` 403s for non-admin roles. |
| 4 | `applyResolvedUserToStore` | same file | same file | ✅ | Dispatches `setUser` to redux. |
| 5 | `getMyUser` REST helper (`/users/my`) | `src/networking/api-requests/user.api.ts` | `src/networking/api-requests/user.api.ts` | ✅ | Added with same signature (token + endpoint override). |
| 6 | `loginViaJwt` (`/users/client`) | `src/networking/api-requests/auth.api.ts` | `src/networking/api-requests/auth.api.ts` | ✅ | Already existed. |
| 7 | `setBaseURL` runtime switch (multi-tenant) | `src/networking/apiClient.ts` | `src/networking/apiClient.ts` | ✅ | `setBaseURL(baseUrl, customAppToken)` + `getCurrentBaseURL/AppToken`. |
| 8 | `clientRegistry` — global singleton, init-lock, reuse key | `src/utils/clientRegistry.ts` | `src/utils/clientRegistry.ts` | ✅ | `buildXmppClientKey`, `getReusableXmppClientByKey`, `withXmppClientInitLock`, `setGlobalXmppClient`. |
| 9 | `XmppClient` accepts `xmppSettingsInterface` (devServer, host, conference, ping, disableLastRead) | `src/networking/xmppClient.ts` | `src/networking/xmppClient.ts` | ✅ | Constructor now accepts `xmppSettings`; back-compat with bare `devServer` string preserved. |
| 10 | `waitForOnline` / `ensureConnected` | `xmppClient.ts` | `xmppClient.ts` | ✅ | Polls `status` with timeout, rejects on `error`. Mirrors web `ensureConnected`. |
| 11 | Exponential reconnect backoff w/ `suppressReconnect` | `xmppClient.ts` | `xmppClient.ts` | ✅ | `scheduleReconnect()` uses `reconnectDelay * 2^(attempts-1)`. `disconnect({suppressReconnect:true})` halts retries. |
| 12 | Provider bootstrap status state machine (`idle / running / ready / failed`) | `src/context/xmppProvider.tsx` | `src/context/xmppProvider.tsx` | ✅ | Surfaced via `useXmppClient().providerBootstrapStatus`. |
| 13 | `initBeforeLoad` provider effect: resolve user → `applyResolvedUserToStore` → prefetch rooms (REST) → `initializeClient` → `waitForOnline` → cache rooms + private store → `ready` | `xmppProvider.tsx` lines 286‑443 | `xmppProvider.tsx` `useEffect` ~lines 110‑200 | ✅ | Same orchestration. Stable bootstrap key prevents re-running on stale renders. AbortController unmount cleanup. |
| 14 | `prefetchRoomsViaRest` (`GET /chats/my`) with 60s in-memory cache | `src/networking/api-requests/rooms.api.ts` | `src/networking/api-requests/rooms.api.ts` | ✅ | New file; 60s per-token cache + in-flight dedup. |
| 15 | `ensureScopedChatCache` — purge state when `appId` / `baseUrl` change | `src/helpers/...` (web) | `src/helpers/ensureScopedChatCache.ts` | ✅ | Tracks scope in AsyncStorage; on mismatch disconnects global client, clears REST cache, dispatches `logout()`, removes persisted user. |
| 16 | Reconnect orchestration in provider (3 tries via `client.reconnect()`, then full reinit) | `xmppProvider.tsx` | `xmppProvider.tsx` (reconnect effect) | ✅ | Tracks `lastCredsRef` for the full reinit fall-back. |
| 17 | Logout event listener (`window.dispatchEvent('ethora-xmpp-logout')`) | `xmppProvider.tsx` lines 452‑492 | `xmppProvider.tsx` (`DeviceEventEmitter.addListener('ethora-xmpp-logout')`) | ✅ | RN equivalent via `react-native` `DeviceEventEmitter`. Helper `emitXmppLogout()` exported. |
| 18 | Client reuse: `getReusableXmppClientByKey` short-circuit in `initializeClient` | `xmppProvider.tsx` lines 166‑251 | `xmppProvider.tsx` `initializeClient` | ✅ | Same three-tier check (global key → provider state → lock+new). |
| 19 | LoginWrapper defers to provider when `initBeforeLoad` is on | `LoginWrapper.tsx` (web) | `src/components/MainComponents/LoginWrapper.tsx` | ✅ | RN now early-returns when `config.initBeforeLoad` is set — no double auth race. |
| 20 | ChatWrapper waits on `providerBootstrapStatus` before initializing | web `useChatWrapperInit.ts` 431‑624 | `src/components/MainComponents/ChatWrapper.tsx` `initXmmpClient` | ✅ | Skips own init while status is `running`; surfaces error UI on `failed`. |
| 21 | ChatWrapper uses `xmppUsername` (falls back to walletAddress) + passes `xmppSettings` | `useChatWrapperInit.ts` | `ChatWrapper.tsx` | ✅ | Adopted the same arg order so multi-tenant servers work. |
| 22 | `getRoomsStanza` + `getChatsPrivateStoreRequestStanza` on mount | both | both | ✅ | Same calls fired post-init. |
| 23 | `useRoomInitialization` per-room presence + history fetch | `src/hooks/useRoomInitialization.tsx` | `src/hooks/useRoomInitialization.tsx` | ✅ | Already present; web's QoS-tagged variant has more knobs (see row 28). |
| 24 | Token refresh (`POST /users/login/refresh`) + axios 401 interceptor | `apiClient.ts` | `apiClient.ts` | ✅ | Already present. AsyncStorage write fixed in `chatSettingsSlice.refreshTokens` (was using web `localStorage`). |
| 25 | `refreshTokens.refreshFunction` custom hook | `apiClient.ts` interceptor | `apiClient.ts` interceptor | ✅ | Already present. |
| 26 | Cache scope persistence (redux-persist) | redux-persist + `ensureScopedChatCache` | `src/roomStore/persistence.ts` + `ensureScopedChatCache.ts` | ✅ | Home-grown AsyncStorage-backed middleware (debounced 200ms writes, 50-msg/room cap, blacklists `editAction`/`activeRoomJID`/`isLoading`/`config`/`client`/modals, sanitizes user secrets). Async rehydrate via `persistorReady`; `clearPersistedState()` called on scope-change + logout. |
| 27 | History preload scheduler / QoS (`historyQoS`, staged preload, top-K rooms) | `xmppClient.ts` send queue + `historyPreloadScheduler.ts` | `src/networking/xmppClient.ts` + `src/helpers/historyPreloadScheduler.ts` | ✅ | Scheduler ported (priority by selected/default-room/activity, retry with jittered backoff, AppState-based visibility pause). `historyQoS` knobs (`stagedPreloadConcurrency`, `stagedPreloadFirstPassSize`, `preloadTopKRooms`) honored. |
| 28 | MAM request registry / in-flight throttling / active-room boost | `xmppClient.ts` | `xmppClient.ts` (`mamInFlightByRoom`, `softPauseUntil`, `activeRoomBoostUntil`) | ✅ | `setActiveRoomJid`, `promoteRoomHistory`, `isActiveRoomGateOpen`, `onCriticalSend`, `enqueueHistoryTask`, `prioritizeRoomPresence`, `getHistoryStanza` accepts `{coalesceRoom, skipIfPreloaded, source}`. Coalesces by room + source rank. |
| 29 | `runHistoryPreloadScheduler` fired post-bootstrap | `xmppProvider.tsx` | `xmppProvider.tsx` | ✅ | Scheduler is kicked off immediately after `providerBootstrapStatus='ready'`, scoped by `selectedRoomJid`/`defaultRoomJids`/QoS settings, with abort signal. |
| 30 | `chatAutoEnterer` (URL → activeRoom) | `src/helpers/chatAutoEnterer.ts` | – | ❌ | Web-specific (URL params). RN equivalent is `Linking` — wire at the app layer by dispatching `setCurrentRoom`. |
| 31 | Push notifications (FCM + service worker) | `usePushNotifications.ts` | – | ❌ | Out of scope. Use `@react-native-firebase/messaging` at the app layer; surface incoming notifications via `Linking` + `setCurrentRoom`. |
| 32 | In-app notification toast system (`MessageNotificationProvider` + `messageNotificationManager`) | web `MessageNotificationContext.tsx` + `utils/messageNotificationManager.ts` | `src/context/MessageNotificationContext.tsx` + `src/utils/messageNotificationManager.ts` | ✅ | Manager queues pending notifications until a subscriber registers, dedupes within 5s. Provider renders RN `Animated` toasts with position config; suppresses for active room and own messages; AppState-aware pruning. Trigger added to `stanzaHandlers.onRealtimeMessage`. Mounted in `ReduxWrapper`. |
| 33 | `storeConsole` debug bridge | `helpers/storeConsole.ts` (`window.useStoreConsole`) | `helpers/storeConsole.ts` (`globalThis.useStoreConsole`) | ✅ | Side-effect import in `ReduxWrapper` enables/disables `globalThis.useStoreConsole` on every store.subscribe based on `config.useStoreConsoleEnabled`. |
| 34 | `eventHandlers.onMessageSent / Failed / Edited` | `useEventHandlers.tsx` + `useSendMessage.tsx` | `src/hooks/useEventHandlers.tsx` + `src/hooks/useSendMessage.tsx` | ✅ | Hook returns the three handlers; `sendMessage` (text), `sendMedia` (per result item), and edit path all emit. Failures route through `handleMessageFailed`. |
| 35 | `clearStoreBeforeInit` config flag | `useChatWrapperInit.ts` | `xmppProvider.tsx` (initBeforeLoad effect) | ✅ | Before resolving user, dispatches `setLogoutState()` + `logout()` and clears the persisted-user AsyncStorage key. |
| 36 | `disableLastRead` propagation | `xmppSettingsInterface.disableLastRead` checked inside private-store methods | `xmppClient.ts` — early-return in `getChatsPrivateStoreRequestStanza` + `actionSetTimestampToPrivateStoreStanza` | ✅ | Constructor reads `xmppSettings.disableLastRead`; both methods short-circuit when set. |
| 37 | Provider/Redux mount order (Redux outside XmppProvider) | web `ReduxWrapper.tsx` | `src/components/MainComponents/ReduxWrapper.tsx` | ✅ | Reordered: `<Provider><XmppProvider><MessageNotificationProvider>...`. |
| 38 | Active-room sync to client (`setActiveRoomJid`) | `useChatWrapperInit.ts` | `ChatWrapper.tsx` useEffect on `activeRoomJID` | ✅ | When redux's `activeRoomJID` changes, `client.setActiveRoomJid(jid)` boosts MAM priority. |
| 39 | Critical-send hint (`onCriticalSend`) | `useSendMessage` | `useSendMessage.tsx` | ✅ | Called before `sendMessage` / `sendMedia` to soft-pause background MAM. |
| 40 | `historyPreloadState` / `historyComplete` / `unreadCapped` room fields | web `roomsSlice` | `roomsSlice.ts` (`IRoom` + `applyRoomsPreloadBatch`) | ✅ | Reducer applies batched patches from the scheduler. |

## How a consumer wires it up now (RN)

```tsx
<ReduxWrapper
  config={{
    initBeforeLoad: true,
    appId: 'my-app',
    baseUrl: 'https://api.chat.ethora.com/v1',
    customAppToken: APP_TOKEN,
    xmppSettings: { devServer: 'xmpp.chat.ethora.com:5443' },
    userLogin: { enabled: true, user: storedUser },
    // or:
    // customLogin: { enabled: true, loginFunction: async () => myAuth() },
    // jwtLogin:   { enabled: true, token: clientJwt },
    refreshTokens: { enabled: true },
  }}
/>
```

Flow on mount (matches the web sequence):

1. `ReduxWrapper` mounts `<Provider>` then `<XmppProvider config={...}>`.
2. `XmppProvider` runs its `initBeforeLoad` effect:
   1. `ensureScopedChatCache(config)` — purge if `appId`/`baseUrl` changed.
   2. `resolveInitBeforeLoadUser({ config })` walks the priority chain.
   3. `applyResolvedUserToStore(user)` dispatches `setUser`.
   4. `prefetchRoomsViaRest()` fires in parallel with XMPP connect.
   5. `initializeClient(xmppUsername, xmppPassword, xmppSettings)` reuses the
      global client via `clientRegistry` or creates a new one under an init lock.
   6. `client.waitForOnline()` resolves.
   7. `client.getRoomsStanza()` + `client.getChatsPrivateStoreRequestStanza()`
      cache rooms + last-read timestamps.
   8. `setStoreClient(c)` + `providerBootstrapStatus = 'ready'`.
3. `LoginWrapper` short-circuits (sees `initBeforeLoad`) and renders `ChatWrapper`.
4. `ChatWrapper.initXmmpClient` sees `providerBootstrapStatus === 'ready'`,
   reuses the client from context, calls `setInited(true)`.
5. `ChatRoom` renders, `useRoomInitialization` fetches history for the active room.

If `initBeforeLoad` is `false` (or omitted), the legacy flow is preserved:
`LoginWrapper` does email/jwt login → `ChatWrapper` creates the client itself.

## Files added

- `src/helpers/resolveInitBeforeLoadUser.ts`
- `src/helpers/ensureScopedChatCache.ts`
- `src/helpers/historyPreloadScheduler.ts`
- `src/utils/clientRegistry.ts`
- `src/utils/messageNotificationManager.ts`
- `src/networking/api-requests/rooms.api.ts`
- `src/context/MessageNotificationContext.tsx`
- `src/hooks/useEventHandlers.tsx`
- `src/roomStore/persistence.ts`

## Files modified

- `src/types/types.ts` — extended `IConfig`, added `xmppSettingsInterface`, `HistoryQoSConfig`, `InAppNotificationConfig`, `HistoryPreloadState`, `ProviderBootstrapStatus`, room QoS fields.
- `src/networking/apiClient.ts` — `setBaseURL`, `getCurrentAppToken`.
- `src/networking/api-requests/user.api.ts` — `getMyUser`.
- `src/networking/xmppClient.ts` — `xmppSettings`, `waitForOnline`, `ensureConnected`, `disconnect`, exponential reconnect, MAM in-flight registry, `setActiveRoomJid`, `promoteRoomHistory`, `isActiveRoomGateOpen`, `onCriticalSend`, `enqueueHistoryTask`, `prioritizeRoomPresence`, `disableLastRead` gating.
- `src/networking/stanzaHandlers.ts` — `onRealtimeMessage` now feeds the global `messageNotificationManager`.
- `src/context/xmppProvider.tsx` — bootstrap status, `initBeforeLoad` effect, logout listener, registry-aware `initializeClient`, post-bootstrap scheduler kickoff, `clearStoreBeforeInit` honored.
- `src/components/MainComponents/ReduxWrapper.tsx` — Provider/XmppProvider/MessageNotificationProvider stack; storeConsole side-effect import.
- `src/components/MainComponents/LoginWrapper.tsx` — defer to provider when `initBeforeLoad=true`.
- `src/components/MainComponents/ChatWrapper.tsx` — consume `providerBootstrapStatus`, pass `xmppSettings`, sync active-room JID to client.
- `src/roomStore/chatSettingsSlice.ts` — replaced web `localStorage` calls with `useLocalStorage` (AsyncStorage).
- `src/roomStore/roomsSlice.ts` — added `applyRoomsPreloadBatch` + room QoS fields.
- `src/roomStore/index.ts` — persistence middleware + async rehydrate (`persistorReady`).
- `src/hooks/useSendMessage.tsx` — emits `onMessageSent` / `onMessageFailed` / `onMessageEdited` events and calls `client.onCriticalSend` before each send.
- `src/helpers/storeConsole.ts` — RN `globalThis` bridge (no `window`).
