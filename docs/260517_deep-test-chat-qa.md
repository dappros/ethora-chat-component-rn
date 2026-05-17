# Deep simulator test — chat-qa.ethora.com, alice ↔ bob

Date: 2026-05-17. Branch: `tf/rn-roomsslice-l1-tests`. Profile:
`mychatapp QA` from `~/.ethora/profiles.json` (chat-qa.ethora.com).

## What was exercised

Logged alice on the iOS sim and bob on the Android emulator against
the same live chat-qa.ethora.com tenant, both via the email-mode auth
path (no JWT shortcut). Confirmed end-to-end:

| Layer                          | iOS alice | Android bob |
|--------------------------------|-----------|-------------|
| REST `/users/login-with-email` | ✅        | ✅          |
| AsyncStorage seed (creds)      | ✅        | ✅          |
| App boot → Chat tab            | ✅        | ✅          |
| REST `/chats/my` → room list   | ✅ (2)    | ✅ (1)      |
| XMPP WebSocket connect         | ✅        | ✅          |
| MUC presence join              | ✅        | ✅          |
| MAM history load               | ✅        | ✅          |
| Per-room render (avatars,      | ✅        | ✅          |
|   sender names, own-vs-other   |           |             |
|   bubbles, delivery ticks,     |           |             |
|   date separators)             |           |             |
| Single-room deep-link mode     | ✅        | ✅          |
| Realtime XMPP propagation      | ✅ (saw bob's typing indicator)         ||
| Send fresh message via UI tap  | ❌ (test-driver limitation, not SDK)    ||

Screenshots committed below the doc (`docs/screenshots/`):
- `ios-alice-rooms.png` — iOS Chat tab, 2 rooms ("Main chat" 1 unread,
  "Chatski" — alice is a member of both)
- `android-bob-rooms.png` — Android Chat tab, 1 room ("Main chat" 8
  unread — bob isn't in Chatski, matches alice's view)
- `ios-alice-room.png` — alice inside Main chat with full MAM history:
  own messages right-aligned blue with double-tick delivered, bob's
  "hello Alice" left-aligned with BT avatar + sender label, May 9 +
  May 12 date separators
- `android-bob-room.png` — bob inside Main chat showing the same
  history from his side (alice's messages left, bob's "hello Alice"
  right with double-tick)
- `ios-bob-is-typing.png` — alice's header momentarily showed
  **"bob is typing ..."** when bob touched the Android input field.
  Real-time XMPP `<composing/>` stanza propagated chat-qa → alice.

## Reproducer

```bash
# Profile lookup
cat ~/.ethora/profiles.json | jq '.profiles."mychatapp QA".endpoints'

# Fresh login (token expires in ~1h)
curl -sS -X POST https://api.chat-qa.ethora.com/v1/users/login-with-email \
  -H "Authorization: $(jq -r '.profiles."mychatapp QA".appToken' ~/.ethora/profiles.json)" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@ethora.com","password":"TestPass123"}'

# Seed iOS sim AsyncStorage (key hashed via MD5, NOT SHA1 — see the
# RNCAsyncStorage.mm RCTMD5Hash usage)
DATA=$(xcrun simctl get_app_container <UDID> com.ethora.chatcomponentrn data)
DIR="$DATA/Library/Application Support/com.ethora.chatcomponentrn/RCTAsyncLocalStorage_V1"
mkdir -p "$DIR"
HASH=$(node -e "console.log(require('crypto').createHash('md5').update('@apploginchatsrn/creds').digest('hex'))")
echo "$CREDS_JSON" > "$DIR/$HASH"
echo '{"@apploginchatsrn/creds":null}' > "$DIR/manifest.json"

# Seed Android emulator AsyncStorage (SQLite RKStorage)
adb push seed.sql /data/local/tmp/seed.sql
adb shell "run-as com.ethora.chatcomponentrn sqlite3 \
  /data/data/com.ethora.chatcomponentrn/databases/RKStorage \
  < /data/local/tmp/seed.sql"
```

Full driver script: `/tmp/rn-deeptest/seed.mjs` (host-only).

## SDK observations worth following up

These aren't blockers — the chat is functionally working — but they
surfaced from the live test and would be worth a JIRA each:

1. **Typing indicator sticky on remote disconnect.** When bob's Android
   went ANR mid-typing (didn't fire `<paused>`), alice's iOS header
   kept showing "bob is typing ..." indefinitely. Workaround at the
   receiver: time-out the typing indicator after ~5s of no further
   `<composing/>` stanzas. The web SDK already does this — port the
   same timer to RN's `useComposing` consumer.
2. **First-bundle ANR is reproducible mid-session, not just on cold
   start.** Documented as cold-start in the README, but a burst of
   user input (rapid input taps + IME shifts) reproduced it. The
   debug bundle (1460 modules) puts the JS thread under enough
   pressure that any sustained main-thread work tips it over.
   Release builds (precompiled Hermes) likely fine; worth measuring
   with a debug-vs-release comparison before treating as bug.
3. **`/chats/my` REST response omits `jid`** — the SDK has to
   reconstruct it as `<name>@<conference.<xmppHost>>`. Already
   handled by `rooms.api.ts:dispatchRoomsFromRestItems`, but the
   server SHOULD just include the jid in the response. Backend ticket.
4. **AppLoginChatsRn UI input field placement relative to keyboard.**
   When the IME comes up, the input row slides to just above the
   keyboard. adb-driven taps at fixed coords miss it. Not a real
   bug — just a note for anyone trying to script UI interaction.

## What's NOT verified

- Sending a fresh message via the in-app UI (couldn't reliably hit
  the send arrow with adb input — driver limitation).
- Media attachment send + render.
- Room creation + invite flow.
- Push notifications (would need FCM setup + a real device, sims
  don't receive APNs).
- Disconnect / reconnect resilience under flaky network.

The first one is worth following up via Maestro / Detox so it's
reproducible — adb-driven coordinate taps aren't a stable signal.

