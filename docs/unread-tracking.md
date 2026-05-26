# Unread message tracking

This document describes the unread-message system in `@ethora/chat-component-rn` — the [`useUnread`](../src/hooks/useUnreadMessagesCounter.ts) hook, how counts are computed and kept in sync, how the "last viewed" marker survives app restarts via the XMPP private store, and how to opt out.

## Table of contents

- [What it does](#what-it-does)
- [Quick start: reading unread counts](#quick-start-reading-unread-counts)
- [How counts are computed](#how-counts-are-computed)
- [Cross-session persistence (XMPP private store)](#cross-session-persistence-xmpp-private-store)
- [The active-room sentinel: `lastViewedTimestamp = 0`](#the-active-room-sentinel-lastviewedtimestamp--0)
- [Built-in UI: the room-list badge](#built-in-ui-the-room-list-badge)
- [Opting out: `disableLastRead`](#opting-out-disablelastread)
- [Edge cases the implementation handles](#edge-cases-the-implementation-handles)
- [Where things live](#where-things-live)

## What it does

- Tracks per-room unread counts that survive backgrounding, app kill, and re-login.
- Rolls them up into a single total for in-app badges (header, tab bar, OS app icon).
- Renders a built-in unread badge on each room in the room list.
- Excludes the user's own messages so MAM-replayed sends on re-login don't bump the badge.
- Doesn't bump counts for the room the user is currently looking at.

## Quick start: reading unread counts

```tsx
import { useUnread } from '@ethora/chat-component-rn';

function HeaderBadge() {
  const { hasUnread, totalCount, unreadByRoom } = useUnread();

  if (!hasUnread) return null;
  return <Badge count={totalCount} />;
}

function RoomTab({ jid }: { jid: string }) {
  const { unreadByRoom } = useUnread();
  const count = unreadByRoom[jid] ?? 0;
  return <Text>{count > 0 ? `(${count})` : ''}</Text>;
}
```

Returned shape:

| Field | Type | Meaning |
| --- | --- | --- |
| `hasUnread` | `boolean` | `true` iff any room has `unreadMessages > 0`. |
| `totalCount` | `number` | Sum of `unreadMessages` across all rooms. |
| `unreadByRoom` | `{ [roomJid: string]: number }` | Per-room counts. **Rooms with zero unread are omitted** — `unreadByRoom[someJid]` may be `undefined`. |

The hook is backed by `useSyncExternalStore`, so it re-renders only when something that affects unread actually changes (it ignores modal toggles, typing indicators, scroll events, etc.).

## How counts are computed

Two paths write `room.unreadMessages`. They use the same exclusion rules and converge on the same answer:

1. **Reducer path** — when `setLastViewedTimestamp({ chatJID, timestamp })` is dispatched:
   - `timestamp === 0` (sentinel meaning "user is actively viewing this room") → `unreadMessages = 0`.
   - Otherwise → count messages with `id > timestamp`, excluding the delimiter sentinel, locally-pending sends, and own messages.

2. **Middleware path** — [`unreadMiddleware`](../src/roomStore/Middleware/unreadMidlleware.tsx) listens for a narrow allow-list of actions (`addRoomMessage`, `setRoomMessages`, `editRoomMessage`, `setLastViewedTimestamp`, `setCurrentRoom`, `addRoom`, `updateRoom`) and recomputes each room's count when the count would have changed. It uses a per-room fingerprint (`messages.length | lastViewedTimestamp`) to skip recomputes when nothing meaningful moved — so dispatch storms don't walk every message of every room.

What "newer than the timestamp" means: the comparison uses `msgSortableMs(message)` — the server-authoritative microsecond timestamp embedded in `message.id`, not `message.date` (which can be client-derived and drifts from the server). This keeps the two count paths in agreement.

Exclusions in both paths:

| Excluded | Why |
| --- | --- |
| `id === 'delimiter-new'` | UI sentinel for the "new messages" separator line, not a real message. |
| `msg.pending === true` | Locally-pending optimistic send; counted on the server side once delivered. |
| `isOwnMessage(msg)` | Sender JID / wallet matches the current user. Catches MAM-replayed self-sends on re-login. |

## Cross-session persistence (XMPP private store)

The `lastViewedTimestamp` per room is persisted to the user's XMPP private store under the `chatjson:store` namespace. That makes it cross-device + cross-session — the same Ethora user logging in from a second device sees the same "I read up to here" markers.

Three triggers write it:

| When | Where | What |
| --- | --- | --- |
| Leaving a room (unmount) | [`ChatRoom.tsx`](../src/components/MainComponents/ChatRoom.tsx) | `actionSetTimestampToPrivateStoreStanza` — stamps just this room. |
| AppState → background / inactive | [`xmppProvider.tsx`](../src/context/xmppProvider.tsx) | `flushLastViewedToPrivateStoreStanza` — batched, all rooms with movement. Without this, killing the app from inside chat would never persist progress. |
| Logout | [`useLogout.tsx`](../src/hooks/useLogout.tsx) | `flushLastViewedToPrivateStoreStanza({ onlyIfNoUnread: true })` — preserves outstanding-unread markers so the next login still surfaces them. |

The flush merges client-side state into the server's current value: server entries newer than the local timestamp win, so two clients can't trample each other's "I read this later than you did".

On reconnect / cold start, the SDK reads `chatjson:store` and seeds each room's `lastViewedTimestamp` from it. The unread middleware then computes per-room counts against the message history that's loaded.

## The active-room sentinel: `lastViewedTimestamp = 0`

Inside the in-memory Redux state, `lastViewedTimestamp = 0` means "user is actively viewing this room right now" — not "epoch zero". The convention exists because the middleware and reducer both need to distinguish "I'm here, clear the badge" from "I read up to time T".

What follows from the convention:

- Entering a room: `setLastViewedTimestamp({ chatJID, timestamp: 0 })` — clears unread immediately.
- Leaving the room: `setLastViewedTimestamp({ chatJID, timestamp: Date.now() })` — stamps "I read up to now".
- Sending a message also stamps `0` — sending implies viewing.
- The flush writer translates the `0` sentinel into `Date.now()` before persisting, so the server never sees the literal zero (which would mark all history unread on next launch).

## Built-in UI: the room-list badge

[`ChatRoomItem`](../src/components/RoomComponents/ChatRoomItem.tsx) renders a small pill in the corner of each room row when `room.unreadMessages > 0`. The pill background uses `config.colors.primary`. No opt-in needed — it's part of the built-in room list.

You don't need `useUnread` to drive this badge; the room list reads `room.unreadMessages` directly from the store. Use `useUnread` to drive **external** UI (app-icon badge, parent screen tab bar, etc.) that lives outside the chat component.

## Opting out: `disableLastRead`

Set on `xmppSettings` (or top-level on the config):

```tsx
<XmppProvider
  config={{
    // …
    xmppSettings: {
      host: 'xmpp.chat.ethora.com',
      conference: 'conference.xmpp.chat.ethora.com',
      disableLastRead: true,
    },
  }}
>
  …
</XmppProvider>
```

When `true`:

- The SDK skips both reads and writes to `chatjson:store`.
- Unread counts still compute in-memory while the app is open, but they don't persist across sessions and won't sync across devices.
- `flushLastViewedToPrivateStoreStanza` returns early; the background-flush and logout-flush paths are no-ops.

Use this if your app already owns "last seen" state in your own backend, or for ephemeral chats where you don't want any server-side read receipts.

## Edge cases the implementation handles

- **MAM replay on re-login** doesn't re-bump unread: own messages are filtered out by JID/wallet matching.
- **Modal opens, scroll events, typing indicators** don't trigger a recompute (the middleware allow-lists trigger actions).
- **50 rooms × 100 messages** isn't a perf hazard: the fingerprint cache short-circuits 99% of dispatches.
- **`unreadCapped`** flag on `IRoom`: set by the history-preload scheduler when the oldest message in memory is itself newer than `lastViewedTimestamp`, meaning the true unread count may exceed what's loaded. Surface this in your UI as "99+" or "many" if you care to distinguish.
- **First paint on a fresh install** doesn't show the entire room as unread: `addRoom` stamps `Date.now()` as the default `lastViewedTimestamp` when neither the private store nor the room payload supplied one.
- **Logout cache reset**: the middleware's per-room fingerprint cache is cleared on `chat/logout` so the next signed-in user doesn't inherit the previous user's "I already saw this count" suppression.

## Where things live

| File | Role |
| --- | --- |
| [`src/hooks/useUnreadMessagesCounter.ts`](../src/hooks/useUnreadMessagesCounter.ts) | Public `useUnread` hook. |
| [`src/roomStore/Middleware/unreadMidlleware.tsx`](../src/roomStore/Middleware/unreadMidlleware.tsx) | Recomputes `room.unreadMessages` on trigger actions. |
| [`src/roomStore/roomsSlice.ts`](../src/roomStore/roomsSlice.ts) | `setLastViewedTimestamp` reducer + `countNewerMessages` helper. |
| [`src/networking/xmpp/flushLastViewedToPrivateStore.ts`](../src/networking/xmpp/flushLastViewedToPrivateStore.ts) | Batched private-store writer. |
| [`src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp.ts`](../src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp.ts) | Single-room private-store writer. |
| [`src/networking/xmpp/getChatsPrivateStoreRequest.xmpp.ts`](../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp.ts) | Reads the `chatjson:store` payload. |
| [`src/components/MainComponents/ChatRoom.tsx`](../src/components/MainComponents/ChatRoom.tsx) | Stamps mount/unmount/send transitions. |
| [`src/context/xmppProvider.tsx`](../src/context/xmppProvider.tsx) | AppState-driven background flush. |
| [`src/components/RoomComponents/ChatRoomItem.tsx`](../src/components/RoomComponents/ChatRoomItem.tsx) | Built-in badge UI in the room list. |
