# UI e2e (Variant 1) — one emulator, real UI

Drives the actual app on a booted simulator/emulator through the full
messaging surface and asserts on what the **sender's own screen** shows
(no second participant needed):

```
text:   send → assert → edit → assert → delete → assert "deleted"
photo:  attach → pick → send → open → close → delete
video:  attach → pick → send → open → play → close → delete
file:   attach → pick → send → open → close → delete   (PDF; best-effort)
```

## Prerequisites

1. **Maestro** on PATH: `curl -Ls "https://get.maestro.mobile.dev" | bash`
2. A **booted device with the app installed**:
   - iOS:     `npm run ios`     (leaves a booted sim with the app)
   - Android: `npm run android` (leaves a booted emulator with the app)
3. **ffmpeg** only if you want to regenerate `e2e/fixtures/` (already committed).

## Run

```bash
npm run e2e:ui -- ios
# or
npm run e2e:ui -- android
```

You'll be asked once for (cached to `e2e/.e2e-creds.json`, gitignored):

| Prompt | Example |
|---|---|
| Base URL | `https://api.messenger-dev2.vitall.com/v1` |
| XMPP host (wss://…/ws) | `wss://xmpp.messenger-dev2.vitall.com/ws` |
| XMPP dev server (host:port) | `xmpp.messenger-dev2.vitall.com` |
| XMPP conference | `conference.xmpp.messenger-dev2.vitall.com` |
| Token (client JWT) | the `x-custom-token` your backend accepts at `POST /users/client` |
| Room JID | `myroom@conference.xmpp.messenger-dev2.vitall.com` (bare name also works) |

These map 1:1 to the testbed Setup fields. The **dev server** is the one the
client actually dials (`wss://${devServer}/ws`); the **host** is the WSS URL —
they're distinct, so fill both.

The runner then: logs in with the token → seeds the testbed creds so the app
boots straight into the room → pushes the gallery fixtures → runs the Maestro
flow on the device.

### Non-interactive / CI

Skip the prompt by passing env vars (they win over the cache):

```bash
E2E_BASE_URL=… E2E_XMPP_HOST=… E2E_CONFERENCE=… E2E_TOKEN=… E2E_ROOM_JID=… \
  npm run e2e:ui -- android
```

## Files

- `full-ui-flow.yaml` — orchestrator (launch + wait-for-room, then the legs).
- `_text.yaml` — text send/edit/delete (fully deterministic).
- `_media.yaml` — one media leg, parameterised by the parent (photo/video/file).
- `../fixtures/` — `image.jpg`, `video.mp4`, `document.pdf`.

## Known soft spots (by design)

- **Native picker** (`_media.yaml`): the OS photo/document picker isn't part of
  the RN tree, so its taps are best-effort and the most likely thing to need
  tuning on a new OS image. Everything else is `testID`-driven and stable.
- **iOS PDF**: the document picker reads the Files app, which is hard to seed
  on a sim. If that leg can't be driven, cover PDF via the headless suite
  (`npm run test:e2e`).
- **Text send on iOS**: if Maestro's `inputText` ever fails to populate the
  input, the first `assertVisible` of the sent text fails loud (it won't pass
  silently). The fix, if needed, is a small `onSubmitEditing` on the input.

---

# UI e2e (Variant 2) — two emulators, two users messaging each other

Boots the app on **both** a booted iOS sim and a booted Android emulator,
logs in **two different users** (one token each) into the **same room**, and
drives a real cross-device round-trip through the UI — delivery asserted
automatically, no human watches either screen:

```
iOS  (user A) sends "<nonce>"  → Android (user B) asserts it arrives
Android (user B) sends "<nonce>" → iOS (user A) asserts it arrives
```

## Prerequisites

- Maestro on PATH.
- **Both** a booted iOS sim **and** a booted Android emulator, each with the
  app installed (`npm run ios` and `npm run android` once).
- **Two** client JWTs — one per user — both members of the same room.

## Run

```bash
npm run e2e:two
```

Asked once (cached to `e2e/.e2e-two-creds.json`, gitignored): Base URL, XMPP
host (wss URL), XMPP dev server (host:port), XMPP conference, Room JID
(shared), then **Token (iOS / user A)** and **Token (Android / user B)**.
Non-interactive: set `E2E_BASE_URL`, `E2E_XMPP_HOST`, `E2E_XMPP_DEV_SERVER`,
`E2E_CONFERENCE`, `E2E_ROOM_JID`, `E2E_TOKEN_IOS`, `E2E_TOKEN_ANDROID`.

The runner logs both users in, seeds each device with its user's creds (same
room), then runs `_two-send.yaml` on the sender and `_two-receive.yaml` on the
receiver for each direction. A non-zero exit on the receiver = the message did
not arrive.

Files: `_two-send.yaml`, `_two-receive.yaml`; orchestrator
`scripts/e2e-two-device.mjs`. Both devices are targeted explicitly via
`maestro --device <udid|serial>` so the right emulator is driven when both are
connected.

## Related

- `e2e/live/` — headless two-persona protocol round-trip (`npm run test:e2e`).
```
