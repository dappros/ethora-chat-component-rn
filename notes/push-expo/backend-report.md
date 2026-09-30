# Push registration from the RN SDK — contract confirmation and Expo push support

**To:** backend
**From:** RN SDK
**Re:** `@ethora/chat-component-rn`, push token registration (next release) + customer request for Expo push tokens

## Context

The RN chat SDK now registers device push tokens itself instead of leaving it to the host app. It uses the same endpoints as the web SDK and the Ethora RN app. A customer also wants to use Expo push tokens (`expo-notifications` → `getExpoPushTokenAsync`), which needs backend work. Below: what the SDK sends today, what was found while verifying against QA/prod, and what we need from the backend.

## What the SDK sends

### Register (on login, on token rotation)

```http
POST /v1/push/subscription/{appId}
Authorization: <user access token>
Content-Type: application/json

{
  "registrationToken": "<token>",
  "deviceType": "ios" | "android",
  "tokenType": "apns" | "apns-voip" | "fcm" | "expo"
}
```

- If the backend answers `422` with `"tokenType" is not allowed`, the SDK retries **without** `tokenType` for `apns` / `fcm` only (the two kinds such a backend infers from `deviceType`).
- `expo` and `apns-voip` are **never** downgraded: filing an Expo token as a native one would make every send fail silently. On a backend without Expo support the client gets the 422, which is the intended signal.

### Release (on logout, before the access token is cleared) and explicit unregister

```http
DELETE /v1/push/subscription/{appId}
Authorization: <user access token>

{ "registrationToken": "<token>" }
```

Fallback on `404`: `DELETE /v1/users/endpoints` with `{ "endpoint": "<token>" }` (same fallback the Ethora RN app uses).

## Findings during verification

1. **The standalone push gateway is unreachable.** `ethora-node-push` at `push.chat.ethora.com/api/v1/subscriptions` (and the QA host) answers `nginx 405 Not Allowed`, so nothing can register there. The old SDK code posted `projectId` while the gateway's Joi schema requires `projectName` and rejects unknown keys, so it never worked either way. The SDK keeps the gateway only as an explicit legacy mode behind `pushNotifications.apiUrl`. **Please confirm whether the gateway is deprecated** so we can drop that mode.
2. **The main API routes exist.** `POST` and `DELETE /v1/push/subscription/{appId}` on QA and prod answer `401 TOKEN_MISSING` without auth. I could not verify with a valid session which `tokenType` values the current deployment accepts.

## Requests

1. **Confirm the current schema** of `POST /v1/push/subscription/{appId}`:
   - accepted `tokenType` values (`apns`, `apns-voip`, `fcm`);
   - whether unknown fields return `422 "<field>" is not allowed` (the SDK's fallback keys off that message);
   - whether the record is upserted per (user, appId, registrationToken).
2. **Add `tokenType: "expo"`.** Store the `ExponentPushToken[...]` and deliver through Expo's push API (`POST https://exp.host/--/api/v2/push/send`):
   - batch up to 100 messages per request;
   - `priority: "high"` for message and call pushes;
   - pass the same `data` keys used today for room and call pushes (`jid` / `chatJid` / `roomJid`, `messageId`, the call fields) so `handlePushPayload` on the client keeps working unchanged;
   - fetch receipts afterwards and drop the subscription on `DeviceNotRegistered`;
   - Expo access token (enhanced push security) configurable per app;
   - until this ships, keep rejecting `expo` with `422` so clients notice.
3. **Confirm `DELETE /v1/push/subscription/{appId}`** with `{ registrationToken }` exists on all clusters, or tell us to rely on `/v1/users/endpoints` only.
4. **Multi-account on one device.** The SDK deletes on logout, but a crash or force-kill skips that. Please make sure registering the same `registrationToken` for user B replaces user A's record for that app, so a device never keeps receiving the previous user's pushes.
5. **Deliverability note for the customer** (no backend action): Expo cannot carry VoIP/PushKit pushes, so incoming-call ringing on a killed iOS app will not work for Expo-token devices. The product answer to the customer depends on this.

## References

- SDK implementation: `src/services/pushRegistration.ts`, `src/networking/api-requests/push.api.ts`
- Contract tests with payload samples: `__tests__/pushRegistration.test.ts`
- Host app reference implementation: `ethora-app-react-native/src/modules/push/`
- Legacy gateway: `ethora-node-push/server.js` (`/api/v1/subscriptions`, Joi schema)
