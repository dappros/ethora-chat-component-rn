# Encrypted pushes

A chat push normally carries the sender's name and the message text in the clear, so Google and Apple can read it on the way. With encrypted pushes the device registers a public key with its push token, the push service seals the content for that key (libsodium sealed box: X25519 + XSalsa20-Poly1305), and the push carries ciphertext only. The app opens it on the device and shows the notification itself: on iOS in a notification service extension, on Android in a background task. The server, Google and Apple only ever see the room JID, the message id and the recipient JID.

Requirements: iOS 16.4+, Android 10+ (API 29), `expo-secure-store` (the key lives in the keychain / keystore), on Android also `expo-notifications` and `expo-task-manager`, and a backend with the push service from October 2026 or later (`pushKey` on `POST /v1/push/subscription/:appId`).

## How it works

1. `ensurePushKeyPair()` creates one X25519 pair per install and keeps it through expo-secure-store: the public key as `publicKey` (base64), the secret key in the keychain / keystore, readable after the first unlock and never leaving the device.
2. The host registers the push token with that public key (`pushKey`). The push service stores it on the subscription, next to the token.
3. Every chat push for that token is then **data-only**: `v`, `alg`, `kid`, `jid`, `msgID`, `userJid` in the clear, `enc` = the sealed box with `title`, `body`, `sender`, `senderJid`, `chat`, `chatJid`, `msgID`, `image` inside. Android gets high priority and the room JID as collapse key; iOS gets a placeholder alert "New message" with `mutable-content` so the extension can rewrite it. Call pushes are never sealed; tokens registered without a key keep the plain pushes.
4. **iOS**: the `EthoraNotificationService` extension (added by the SDK's config plugin) reads the secret key from the keychain, opens the box and sets the real title and text. Anything that fails leaves the "New message" placeholder.
5. **Android**: the SDK's background task (`registerSealedPushTask`) runs for every data-only push, in the foreground, background and with the app killed, opens the box and posts a local notification: one per chat (newer replaces older), the real text, or the placeholder when the box does not open.
6. Tapping the notification reaches the host's response listener with `jid` and `msgID` on the notification data, the same as for a plain push; `handlePushPayload` opens the room.
7. Logout: unregistering the token (`unregisterPushToken` / `DELETE /v1/push/subscription/:appId`) removes the key with it. Reinstall: a new pair is created, the next registration sends the new key; a push sealed for the old key shows the placeholder.

## Setup

### 1. Packages

```bash
npx expo install expo-secure-store expo-notifications expo-task-manager
```

### 2. app.json

The config plugin adds the iOS extension and a keychain access group shared by the app and the extension (`$(AppIdentifierPrefix)<bundle id>`, listed first in `keychain-access-groups` so expo-secure-store's items, written without an explicit group, land in it). `ios.appleTeamId` is needed for the extension's signing.

```json
{
  "expo": {
    "ios": { "bundleIdentifier": "com.example.app", "appleTeamId": "ABCDE12345" },
    "plugins": ["@ethora/chat-component-rn", "expo-secure-store", "expo-notifications"]
  }
}
```

Run `npx expo prebuild` afterwards (iOS native settings only exist in the generated project). With EAS Build the extension and its entitlements are registered under `extra.eas.build.experimental.ios.appExtensions`; the Keychain Sharing capability is turned on by the entitlement.

### 3. The key and the registration

```ts
import { ensurePushKeyPair, registerPushToken } from '@ethora/chat-component-rn';

const key = await ensurePushKeyPair(); // null only without expo-secure-store
await registerPushToken(nativeToken, { tokenType: 'apns', pushKey: key?.publicKey });
```

or, when the SDK asks the host for tokens:

```ts
pushNotifications: {
  getPushTokens: async () => {
    const key = await ensurePushKeyPair();
    return { token: await getNativeToken(), tokenType: 'fcm', pushKey: key?.publicKey };
  },
},
```

A host that registers the token with its own request sends the same three fields the SDK sends: `pushKey` (base64 of the raw 32-byte public key), `pushKeyAlg: "sealed-box-x25519"` and, optionally, `pushKeyId` (`key.keyId`; the service derives the same id when it is absent). Re-registering the token without `pushKey` keeps the stored key, `"pushKey": ""` removes it.

If the backend does not know `pushKey`, `registerPushToken` throws `PushRegistrationError` ("the backend does not support encrypted pushes") instead of registering in the clear.

### 4. Android: the background task

Define the task before anything else in the app loads. With expo-router that means a custom entry file:

```ts
// index.ts  (package.json: "main": "index.ts")
import { registerSealedPushTask } from '@ethora/chat-component-rn';
registerSealedPushTask({ channelId: 'messages', reactionChannelId: 'reactions' });
import 'expo-router/entry';
```

`channelId` is the Android notification channel to post on (create it with `Notifications.setNotificationChannelAsync`; omitted, the OS default channel is used). `reactionChannelId` is the channel for a push about an emoji put on the user's message (`type: 'reaction'` in the envelope): create it silent, the way Telegram shows reactions; omitted, `channelId` is used. A reaction is posted with its own identifier per chat, so it never replaces the chat's new-message notification. `placeholderTitle` / `placeholderBody` replace the "New message" (or "New reaction") placeholder.

### 5. iOS: nothing else

The extension ships with the config plugin. It also shows the attachment preview of plain photo / video pushes.

## What the user sees when it fails

| Case                                                     | iOS                      | Android                  |
| -------------------------------------------------------- | ------------------------ | ------------------------ |
| Phone not unlocked since reboot                          | "New message"            | "New message"            |
| App reinstalled, push sealed for the old key             | "New message"            | "New message"            |
| Service could not seal (no `enc`)                        | "New message"            | "New message"            |
| `expo-secure-store` missing                              | plain pushes (no key is registered) | same          |
| `expo-task-manager` missing                              | n/a                      | nothing is shown         |

## Checking it

- The push worker logs `sealed: true` for the send, and the subscription in Mongo carries `pushKey`, `pushKeyAlg`, `pushKeyId`.
- The raw push (Console.app on a Mac for iOS, `adb logcat` for Android) carries `alg`, `kid`, `jid`, `msgID`, `userJid`, `enc` and no text.
- The device shows the real sender and text with the app in the background and after it was killed (swipe it away from the recents on both; Android's Force stop also blocks pushes until the next launch, so do not use it). On Android, `adb shell dumpsys deviceidle force-idle` before sending checks that high priority gets through Doze (`unforce` afterwards).
- Several messages in one chat collapse into one notification; a message in another chat is a second one.
- After logout no push arrives, and the subscription is gone.

## Internals

- JS: `src/push/sealedBox.ts` (sealed box on `@noble/*`, pinned against libsodium in `__tests__/sealedBox.test.ts`), `src/push/sealedPush.ts` (envelope), `src/push/pushKeyStore.ts` (key storage), `src/push/sealedPushTask.ts` (Android).
- iOS: `plugins/notification-service/SealedBox.swift` (CryptoKit X25519 + tweetnacl ports, pinned against libsodium by `plugins/notification-service/check/run.sh`) and `NotificationService.swift`. The keychain item: generic password, service `ethora.push:no-auth`, account `ethora_push_secret_key`, value = base64 of the secret key.
- Backend: ethora-backend `services/push/README.md`, "Encrypted pushes".
