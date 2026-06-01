#!/usr/bin/env bash
# Run the Maestro auth-and-send flow against either iOS sim or Android
# emulator, pulling credentials from an ~/.ethora/profiles.json entry
# (the same store the ethora-setup CLI writes to).
#
# Usage:
#   scripts/run-e2e.sh ios|android [profile-name] [room-title]
#
# Examples:
#   scripts/run-e2e.sh ios
#   scripts/run-e2e.sh ios "Sample Profile" "Main chat"
#   scripts/run-e2e.sh android "Sample Profile"
#
# Defaults: first profile in ~/.ethora/profiles.json, room title
# "Main chat", user email/password = the first entry in profile.testUsers.
set -euo pipefail

PLATFORM="${1:-ios}"
PROFILE_NAME="${2:-}"
ROOM_TITLE="${3:-Main chat}"

PROFILE_PATH="$HOME/.ethora/profiles.json"
if [ ! -f "$PROFILE_PATH" ]; then
  echo "error: $PROFILE_PATH not found. Run \`npx @ethora/setup\` first." >&2
  exit 2
fi

if [ -z "$PROFILE_NAME" ]; then
  PROFILE_NAME="$(node -e "
    const fs = require('fs');
    const profiles = JSON.parse(fs.readFileSync('$PROFILE_PATH', 'utf8')).profiles || {};
    const first = Object.keys(profiles)[0] || '';
    if (!first) process.exit(1);
    process.stdout.write(first);
  " || true)"
  if [ -z "$PROFILE_NAME" ]; then
    echo "error: no profiles found in $PROFILE_PATH" >&2
    exit 3
  fi
fi

# Pull the profile via node (avoids a jq dependency). One field per
# line — the JWT app token has a literal "JWT " prefix with a space,
# so word-splitting on whitespace would scramble the fields.
TMP_FIELDS="$(mktemp)"
node -e "
  const fs = require('fs');
  const p = JSON.parse(fs.readFileSync('$PROFILE_PATH', 'utf8')).profiles['$PROFILE_NAME'];
  if (!p) { console.error('profile not found'); process.exit(4); }
  const u = (p.testUsers || [])[0];
  if (!u) { console.error('profile has no testUsers'); process.exit(5); }
  console.log(p.appToken);
  console.log(p.endpoints.apiUrl);
  console.log(p.endpoints.xmppHost);
  console.log(p.endpoints.xmppConference);
  console.log(u.email);
  console.log(u.password);
" > "$TMP_FIELDS"
APP_TOKEN="$(sed -n '1p' "$TMP_FIELDS")"
BASE_URL="$(sed -n '2p' "$TMP_FIELDS")"
XMPP_HOST="$(sed -n '3p' "$TMP_FIELDS")"
CONFERENCE="$(sed -n '4p' "$TMP_FIELDS")"
USER_EMAIL="$(sed -n '5p' "$TMP_FIELDS")"
USER_PASSWORD="$(sed -n '6p' "$TMP_FIELDS")"
rm -f "$TMP_FIELDS"

if [ -z "$APP_TOKEN" ]; then
  echo "error: missing app token from profile" >&2
  exit 6
fi

MAESTRO_RUN_ID="$(date +%s)"

# Maestro needs to be on PATH + a JDK. Auto-detect Android Studio's JBR
# on macOS — saves the caller from having to set JAVA_HOME themselves.
export PATH="$HOME/.maestro/bin:$PATH"
if [ -z "${JAVA_HOME:-}" ]; then
  if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  fi
fi

case "$PLATFORM" in
  ios)
    # Maestro's --device target needs the UDID the app was built and
    # installed against. We pick in this priority order:
    #   1. an already-booted sim where com.ethora.chatcomponentrn is
    #      installed (the obvious win when `npx expo run:ios` left a
    #      ready sim behind)
    #   2. a Shutdown sim with the app installed (boot it on demand)
    #   3. any exact-match "iPhone 16" sim (final fallback — the app
    #      probably isn't there yet; flow will fail loud)
    #
    # Earlier versions of this picker used `grep -m1 "iPhone 16"`
    # which alphabetically grabbed "iPhone 16 Pro" — a different sim
    # without the app — and Maestro crashed on clearState.
    APP_BUNDLE="com.ethora.chatcomponentrn"
    UDID=""
    # Scan every device with the app installed.
    while read -r CANDIDATE; do
      [ -z "$CANDIDATE" ] && continue
      if xcrun simctl get_app_container "$CANDIDATE" "$APP_BUNDLE" >/dev/null 2>&1; then
        STATE="$(xcrun simctl list devices 2>/dev/null | grep -F "$CANDIDATE" | grep -oE '\((Booted|Shutdown)\)' | head -1)"
        if [ "$STATE" = "(Booted)" ]; then
          UDID="$CANDIDATE"; break
        fi
        # Stash a fallback shutdown candidate but keep scanning for booted.
        [ -z "$FALLBACK_UDID" ] && FALLBACK_UDID="$CANDIDATE"
      fi
    done < <(xcrun simctl list devices 2>/dev/null | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}')
    if [ -z "$UDID" ] && [ -n "${FALLBACK_UDID:-}" ]; then
      UDID="$FALLBACK_UDID"
    fi
    if [ -z "$UDID" ]; then
      # Last-resort strict name match: device line looks like
      #   "    iPhone 16 (UDID) (Shutdown)"
      # The trailing " (" after the name excludes Pro / Plus / e
      # variants whose names continue past "iPhone 16".
      UDID="$(xcrun simctl list devices 2>/dev/null | grep -E '    iPhone 16 \(' | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)"
      echo "warn: no sim with $APP_BUNDLE installed — falling back to a fresh iPhone 16. Run \`npm run ios\` first." >&2
    fi
    if [ -z "$UDID" ]; then
      echo "error: no iPhone 16 simulator found" >&2; exit 7
    fi
    xcrun simctl boot "$UDID" 2>/dev/null || true
    open -a Simulator 2>/dev/null || true
    DEVICE_ARG="--device $UDID"
    echo "Using iOS sim UDID: $UDID"
    IOS_UDID="$UDID"
    ;;
  android)
    # Assume an emulator is already booted (`emulator -avd Pixel_6` etc).
    if ! adb devices | grep -q "emulator-"; then
      echo "error: no Android emulator running. Start one with: \`emulator -avd Pixel_6\`" >&2; exit 8
    fi
    DEVICE_ARG=""
    ;;
  *)
    echo "error: platform must be 'ios' or 'android', got '$PLATFORM'" >&2; exit 1
    ;;
esac

# Login the user against the configured environment and seed the
# testbed's AsyncStorage with the resolved Creds. This sidesteps the
# in-app Setup UI (typing a 600-char JWT into a multiline TextInput
# via Maestro's inputText proved both slow and lossy — sims will
# occasionally drop chars on long pastes, and iOS QuickPath tutorial
# popups can intercept taps). After seeding, the app boots straight
# to Chat tab so Maestro can focus on what we actually want to test:
# the chat thread render + send + receive path.
echo "Logging in $USER_EMAIL and seeding $PLATFORM AsyncStorage..."
ROOM_JID_ARG=""
if [ -n "$ROOM_TITLE" ]; then
  # ROOM_JID is needed by the singleRoom Creds flag so the app
  # auto-enters the room (no extra tap needed in the Maestro flow).
  # We don't have a name→jid lookup here, so the caller can set
  # ROOM_JID directly if known; otherwise fall back to a derived
  # local part of the room name (rare to be correct, so usually you
  # want to pass ROOM_JID explicitly).
  ROOM_JID_ARG="${ROOM_JID:-}"
fi
SEED_OUTPUT="$(
  PROFILE_NAME="$PROFILE_NAME" \
  PLATFORM="$PLATFORM" \
  IOS_UDID="${IOS_UDID:-}" \
  ROOM_TITLE="$ROOM_TITLE" \
  ROOM_JID="$ROOM_JID_ARG" \
  node scripts/seed-e2e-creds.mjs 2>&1
)"
echo "$SEED_OUTPUT"
# The seed script logs the derived room JID on its last line — pass
# it through as ROOM_JID so the YAML can use it for assertions.
RESOLVED_ROOM_JID="$(echo "$SEED_OUTPUT" | grep -oE 'ROOM_JID=[^ ]+' | tail -1 | cut -d= -f2)"

echo "Running Maestro flow:"
echo "  platform     : $PLATFORM"
echo "  profile      : $PROFILE_NAME"
echo "  user         : $USER_EMAIL"
echo "  baseUrl      : $BASE_URL"
echo "  room         : $ROOM_TITLE"
echo "  room jid     : ${RESOLVED_ROOM_JID:-(none — Maestro will open by title)}"
echo "  run id       : $MAESTRO_RUN_ID"
echo ""

exec maestro $DEVICE_ARG test \
  -e APP_TOKEN="$APP_TOKEN" \
  -e USER_EMAIL="$USER_EMAIL" \
  -e USER_PASSWORD="$USER_PASSWORD" \
  -e BASE_URL="$BASE_URL" \
  -e XMPP_HOST="$XMPP_HOST" \
  -e CONFERENCE="$CONFERENCE" \
  -e ROOM_TITLE="$ROOM_TITLE" \
  -e MAESTRO_RUN_ID="$MAESTRO_RUN_ID" \
  e2e/auth-and-send.yaml
