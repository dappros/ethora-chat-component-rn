# Reply to the customer — Expo push tokens

Thanks for raising this. Good news: the SDK is already closer to what you describe than the docs suggested, and we've just finished the SDK-side work.

## Where things stand

The SDK does not request an FCM token from Firebase and has no Firebase dependency. The Firebase-based hook you saw was legacy code that was never mounted or exported; we've removed it and rewritten the push docs around the real contract: your app owns the native side (permission, token, tap listeners) with whatever library it uses, and the SDK owns everything behind the token.

## What the SDK now provides (next release)

- `registerPushToken(token, { tokenType? })` — hand us the token from `getExpoPushTokenAsync()` and the SDK registers it with the backend under the signed-in user (`POST /v1/push/subscription/{appId}`). It's safe to call before sign-in (it registers on login), it releases the registration on logout and re-registers automatically when a different account logs in, and it dedupes the same token for the same account.
- Expo tokens are detected by shape (`ExponentPushToken[...]`) and sent as `tokenType: 'expo'`; native APNs/FCM tokens keep working as before.
- `unregisterPushToken()` removes the registration from the backend, and `handlePushPayload(data)` / `openRoomFromPush(jid)` handle taps: pass `response.notification.request.content.data` from `addNotificationResponseReceivedListener` and the SDK opens the room or rings the call.
- Registration failures surface as real errors (`PushRegistrationError` with the HTTP status and body).

So the SDK-side items on your list are done, and room-level subscriptions are still handled by the SDK on every login.

## What's still needed on our backend

It currently delivers to native APNs/FCM tokens. It has to accept `tokenType: 'expo'` and send those through Expo's push API with your project's credentials (batched, with receipt handling so dead tokens get dropped). Until that lands, registering an Expo token returns HTTP 422 by design, so you'll see the incompatibility immediately instead of a token that silently never receives anything. We're scoping that now.

## Two things to decide on your side

1. **Android still needs FCM.** Expo Push is a relay on top of APNs/FCM, so you keep `google-services.json` in the app and the FCM V1 service account plus APNs key in your Expo project. What you drop is the Firebase SDK in the app, not FCM.
2. **Calls from push.** Our incoming-call flow relies on data pushes that wake the app; Expo doesn't support VoIP/PushKit on iOS and its background data handling is limited. If you use audio/video calls, ringing a killed app on iOS won't work over Expo Push. Are calls in scope for you? That changes what we'd recommend.

## Integration sketch

```ts
import * as Notifications from 'expo-notifications';
import { registerPushToken, handlePushPayload } from '@ethora/chat-component-rn';

const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
await registerPushToken(token); // detected as tokenType: 'expo'
Notifications.addPushTokenListener(({ data }) => registerPushToken(data));
Notifications.addNotificationResponseReceivedListener((r) =>
  handlePushPayload(r.notification.request.content.data)
);
```
