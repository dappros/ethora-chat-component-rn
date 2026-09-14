# Unread message tracking

This document describes the unread-message system in `@ethora/chat-component-rn` — the [`useUnread`](../src/hooks/useUnreadMessagesCounter.ts) hook, how counts are computed and kept in sync, how the "last viewed" marker survives app restarts via the XMPP private store, and how to opt out.

## Table of contents

- [What it does](#what-it-does)
- [Quick start: reading unread counts](#quick-start-reading-unread-counts)
- [How counts are computed](#how-counts-are-computed)
- [Cross-session persistence (XMPP private store)](#cross-session-persistence-xmpp-private-store)
  - [The read boundary: leaving a room while scrolled up](#the-read-boundary-leaving-a-room-while-scrolled-up)
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

Several triggers write it - every one of them goes through [`getReadMarkerTimestamp`](../src/helpers/getServerReadTimestamp.ts), never `Date.now()`:

| When | Where | What |
| --- | --- | --- |
| Leaving a room (unmount) | [`ChatRoom.tsx`](../src/components/MainComponents/ChatRoom.tsx) | `setLastViewedTimestamp` + `flushLastViewedToPrivateStoreStanza` - stamps just this room. |
| AppState → background / inactive | [`xmppProvider.tsx`](../src/context/xmppProvider.tsx) | `flushLastViewedToPrivateStoreStanza` - batched, all rooms with movement. Without this, killing the app from inside chat would never persist progress. |
| Host's `isVisible` prop flips to `false` | [`xmppProvider.tsx`](../src/context/xmppProvider.tsx) | Same stamp + flush, for hosts that keep `<Chat>` mounted in a hidden tab. |
| A tab-navigator loses focus | [`useChatRoomFocus.ts`](../src/hooks/useChatRoomFocus.ts) | Same stamp + flush, driven by the consumer's own focus signal. |
| Logout | [`useLogout.tsx`](../src/hooks/useLogout.tsx) | `flushLastViewedToPrivateStoreStanza({ onlyIfNoUnread: true })` - preserves outstanding-unread markers so the next login still surfaces them. |

The flush merges client-side state into the server's current value: server entries newer than the local timestamp win, so two clients can't trample each other's "I read this later than you did". A boundary write (see below) overrides only which VALUE is chosen for the visible room (`visibleRoomTs` instead of "the newest acked message"); it is still subject to the same forward-only comparison, so it can lower the server marker only when nothing larger has already been written for that room.

**Never `Date.now()`.** A device clock running ahead used to write a future marker that this forward-only merge could never correct again - once written, every later *correct* value from any device looked "older" and was silently dropped (bug #38). The marker is always anchored to a real server-acknowledged message id instead (see [`getServerReadTimestamp`](../src/helpers/getServerReadTimestamp.ts)), which can never be ahead of what the server itself has recorded. A stored marker that nonetheless looks impossibly far in the future (a leftover from before this fix, or a corrupted value) is detected and self-healed - see `isCorruptFutureReadMarker`.

On reconnect / cold start, the SDK reads `chatjson:store` and seeds each room's `lastViewedTimestamp` from it. The unread middleware then computes per-room counts against the message history that's loaded.

### The read boundary: leaving a room while scrolled up

Stamping "the newest message the server has" is correct when the user is at the bottom of the room, but wrong when they scrolled up, read older content, and left without scrolling back down - that would silently mark messages they never saw as read, both locally and (because the private-store merge is forward-only) permanently on the server.

`MessageList` tracks this: the moment the user first scrolls away from the bottom, it snapshots the newest message they'd actually seen and reports it via `onReadBoundaryChange`. `ChatRoom` mirrors that value into `rooms.readBoundaries[jid]` in redux - a per-room map, not persisted, and not a component ref - so it's a single source of truth every "leaving this room" path above can read, not just `ChatRoom`'s own unmount. `getReadMarkerTimestamp(room, heapState, boundaryTs)` uses the boundary when one is set (clamped so it can never exceed the newest acked message), and otherwise falls back to `getServerReadTimestamp`'s usual "newest acked message" behaviour.

The boundary is cleared when it stops applying: the user scrolls back to the bottom, the room changes, or the room is genuinely left (`ChatRoom` unmounts, or a tab-navigator's focus hook releases the room to switch to another one). It is deliberately **not** cleared merely because the app backgrounds or a host's `isVisible` flips false - `MessageList` typically stays mounted through both, so its own scroll-tracking ref is still the source of truth and the redux copy has to stay in sync with it.

The live `advance()` effect (stamps the marker forward as messages arrive while the room is visible) also respects the boundary: while one is set, it clamps to it instead of advancing to the newest incoming message, and its debounced flush to the server passes the same boundary as `visibleRoomTs`.

## The active-room sentinel: `lastViewedTimestamp = 0`

Inside the in-memory Redux state, `lastViewedTimestamp = 0` means "user is actively viewing this room right now" - not "epoch zero". The convention exists because the middleware and reducer both need to distinguish "I'm here, clear the badge" from "I read up to time T".

What follows from the convention:

- Entering a room: `setVisibleRoom` zeroes `unreadMessages` directly (it does not rewrite `lastViewedTimestamp` to `0`) - the room is tracked as visible via `visibleRoomJID`, and the unread middleware skips the visible room entirely.
- Leaving the room: `setLastViewedTimestamp({ chatJID, timestamp })` stamps the value `getReadMarkerTimestamp` resolved (the read boundary if one is set, else the newest server-acked message) - never `Date.now()` and never unconditionally "everything".
- A brand new room with no messages and no prior marker stamps `0`, treated as "unknown" rather than substituting a device-clock guess.

## Built-in UI: the room-list badge

[`ChatRoomItem`](../src/components/RoomComponents/ChatRoomItem.tsx) renders a small pill in the corner of each room row when `room.unreadMessages > 0`. The pill background uses `config.colors.primary`. No opt-in needed — it's part of the built-in room list.

You don't need `useUnread` to drive this badge; the room list reads `room.unreadMessages` directly from the store. Use `useUnread` to drive **external** UI (app-icon badge, parent screen tab bar, etc.) that lives outside the chat component.

## Tab-based navigators: `useChatRoomFocus`

First, the case you **don't** have to handle: **app background/foreground is automatic.** When the OS backgrounds the app, the provider stamps the read marker for the open room (the [read boundary](#the-read-boundary-leaving-a-room-while-scrolled-up) if the user had scrolled up, otherwise the newest message) and clears its "viewed" state, so messages that arrive while you're away count as unread (rather than looking already-read); foreground restores it. (It also drops the open room's "New messages" divider so it doesn't linger.)

The case you *do* handle: an **in-app tab/route switch** where `<Chat>` **stays mounted while hidden** (the common React Navigation case). The SDK can't tell "looking at the chat" from "on another tab", so without a signal `useUnread()` would report **0** for that room while messages arrive in the background. **Do not** reach into internal paths (`src/roomStore`, `setLastViewedTimestamp`, …) — signal it one of two public ways:

**Option A — the `isVisible` prop on `<Chat>` (simplest):**

```tsx
function ChatTab({ currentTab }: { currentTab: string }) {
  // The library clears the room's "viewed" state (so messages count as
  // unread) when hidden and restores it when shown.
  return <Chat config={/* … */} isVisible={currentTab === 'chat'} />;
}
```

**Option B — the [`useChatRoomFocus`](../src/hooks/useChatRoomFocus.ts) hook**, driven by your navigator's focus signal:

```tsx
import { useIsFocused } from '@react-navigation/native';
import { useChatRoomFocus, useUnread } from '@ethora/chat-component-rn';

function ChatTab() {
  const isFocused = useIsFocused();
  useChatRoomFocus({ roomJID: 'general@conference.host', isFocused });
  return <Chat config={/* … */} roomJID="general@conference.host" />;
}

// elsewhere (e.g. your tab bar):
const { totalCount } = useUnread(); // now updates correctly on blur/focus
```

Either way: shown → the room is marked actively-viewed (badge clears); hidden → the read marker is stamped (the [read boundary](#the-read-boundary-leaving-a-room-while-scrolled-up) if the user had scrolled up, otherwise the newest message) **and** the active-room marker is released so subsequent messages count as unread. No internal imports required. (If you **unmount** `<Chat>` when it's hidden, you need neither - mount/unmount already handles it.)

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
| [`src/roomStore/roomsSlice.ts`](../src/roomStore/roomsSlice.ts) | `setLastViewedTimestamp` reducer + `countNewerMessages` helper + the `readBoundaries` map (`setReadBoundary` / `clearReadBoundary`). |
| [`src/helpers/getServerReadTimestamp.ts`](../src/helpers/getServerReadTimestamp.ts) | `getServerReadTimestamp` (newest acked message) + `getReadMarkerTimestamp` (boundary-aware wrapper) + the bug #38 self-heal check. |
| [`src/helpers/insertMessageWithDelimiter.ts`](../src/helpers/insertMessageWithDelimiter.ts) | Positions the "New messages" divider for a room that isn't currently visible; compares on the same `msgSortableMs` source as the unread count. |
| [`src/networking/xmpp/flushLastViewedToPrivateStore.ts`](../src/networking/xmpp/flushLastViewedToPrivateStore.ts) | Batched private-store writer; `visibleRoomTs` carries the read boundary through to the server marker. |
| [`src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp.ts`](../src/networking/xmpp/actionSetTimestampToPrivateStore.xmpp.ts) | Single-room private-store writer. |
| [`src/networking/xmpp/getChatsPrivateStoreRequest.xmpp.ts`](../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp.ts) | Reads the `chatjson:store` payload. |
| [`src/components/MainComponents/MessageList.tsx`](../src/components/MainComponents/MessageList.tsx) | Tracks the read boundary (`onReadBoundaryChange`) as the user scrolls; renders the local "new messages" divider. |
| [`src/components/MainComponents/ChatRoom.tsx`](../src/components/MainComponents/ChatRoom.tsx) | Mirrors the boundary into redux; stamps mount/unmount/send transitions. |
| [`src/context/xmppProvider.tsx`](../src/context/xmppProvider.tsx) | AppState-driven background flush, `isVisible` handler, and the live `advance()` effect - all boundary-aware. |
| [`src/hooks/useChatRoomFocus.ts`](../src/hooks/useChatRoomFocus.ts) | Tab-navigator focus/blur stamping, also boundary-aware. |
| [`src/components/RoomComponents/ChatRoomItem.tsx`](../src/components/RoomComponents/ChatRoomItem.tsx) | Built-in badge UI in the room list. |
