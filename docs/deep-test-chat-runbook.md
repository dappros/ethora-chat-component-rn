# Deep simulator test runbook

Use this checklist to validate the RN chat SDK side-by-side on iOS and Android against your own QA or staging environment.

## What to exercise

Confirm end-to-end behavior for two test users connected to the same environment:

| Layer                          | iOS user A | Android user B |
|--------------------------------|------------|----------------|
| REST `/users/login-with-email` | ✅         | ✅             |
| AsyncStorage seed (creds)      | ✅         | ✅             |
| App boot → Chat tab            | ✅         | ✅             |
| REST `/chats/my` → room list   | ✅         | ✅             |
| XMPP WebSocket connect         | ✅         | ✅             |
| MUC presence join              | ✅         | ✅             |
| MAM history load               | ✅         | ✅             |
| Per-room render                | ✅         | ✅             |
| Single-room deep-link mode     | ✅         | ✅             |
| Realtime XMPP propagation      | ✅         | ✅             |
| Send fresh message via UI tap  | ✅         | ✅             |

Capture screenshots for:
- room list on iOS
- room list on Android
- same room open on both devices
- typing indicator propagation
- unread badge / single-room behavior if relevant

## Reproducer

```bash
# Inspect the chosen profile
cat ~/.ethora/profiles.json | jq '.profiles["Sample Profile"].endpoints'

# Fresh login
curl -sS -X POST https://api.example.com/v1/users/login-with-email \
  -H "Authorization: $(jq -r '.profiles["Sample Profile"].appToken' ~/.ethora/profiles.json)" \
  -H "Content-Type: application/json" \
  -d '{"email":"user-a@example.com","password":"REPLACE_ME"}'

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

The repo's `scripts/run-e2e.sh` + `scripts/seed-e2e-creds.mjs` automate the same setup using a profile from `~/.ethora/profiles.json`.

## SDK observations to watch for

These are the main classes of issues worth recording during a deep run:

1. Typing indicator state not clearing after disconnect or backgrounding.
2. Reconnect / rejoin regressions after network loss or long idle.
3. `/chats/my` room hydration mismatches versus the reconstructed MUC JID.
4. Keyboard/input placement issues across device sizes and safe areas.
5. Single-room unread, badge, and delimiter regressions in mounted-tab hosts.

## Not verified unless you test them explicitly

- media attachment send + render
- room creation + invite flow
- push notifications on real devices
- flaky-network reconnect resilience
- long offline recovery
