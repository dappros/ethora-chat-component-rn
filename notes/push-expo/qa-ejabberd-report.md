# QA ejabberd refuses MucSub for existing chats — pushes cannot be delivered

**To:** backend
**From:** mobile (RN SDK + Ethora RN app)
**Environment:** QA — `api.chat-qa.ethora.com`, `xmpp.chat-qa.ethora.com`, `conference.xmpp.chat-qa.ethora.com`
**Dates observed:** 2026-09-29 … 2026-10-01

## Summary

Push notifications do not arrive for users on QA because ejabberd refuses the MucSub subscription (`urn:xmpp:mucsub:0`) for every room the REST API lists in `/v1/chats/my`. ejabberd only pushes offline messages to MucSub subscribers, so with 0 subscribed rooms no push is ever sent, regardless of the device token (which registers fine: `POST /v1/push/subscription/{appId}` → `apns` token accepted, "new contract").

This is server state on QA, not the client: the same refusals come back to a bare `@xmpp/client` session from a laptop, with no SDK involved, and the SDK's MucSub code is byte-identical between the version that used to work (26.7.8) and the current one (26.8.4).

## Evidence

Test account: `646cc8dc96d4a4dc8f7b2f2d_66f5edf81b762117e1bfa26a@xmpp.chat-qa.ethora.com` (John, `colod20205@…`, app `646cc8dc96d4a4dc8f7b2f2d`). The RN app on an iPhone reports:

```
[PushService] MucSub subscribe error for '…_66f5edf8…-…_6a3936270fb6259426733029@conference.xmpp.chat-qa.ethora.com', 'forbidden'
[PushService] MucSub subscribe error for '…_66f5edf8…-…_6a3935d80fb625942673298b@conference.xmpp.chat-qa.ethora.com', 'forbidden'
[PushService] MucSub subscribe error for '…_66f5edf8…-…_6a2718bcef26ca2d3e1b78c3@conference.xmpp.chat-qa.ethora.com', 'forbidden'
[PushService] MucSub: 0 rooms subscribed, 20 failed
[push] registered apns token (platform, new contract) on chat-qa.ethora.com
```

Direct XMPP probe (fresh `login-with-email`, WSS to `xmpp.chat-qa.ethora.com/ws`, no SDK), full error text:

**1:1 room** `646cc8dc96d4a4dc8f7b2f2d_6687a44597fb0a685c5413fc-646cc8dc96d4a4dc8f7b2f2d_66f5edf81b762117e1bfa26a@conference.…`

```
disco#info           → no identity, no features (room does not exist on ejabberd)
presence join        → <error type="auth"><forbidden/> Room creation is denied by service policy
mucsub subscribe     → <error type="auth"><forbidden/> Room creation is denied by service policy
```

**Group room** `646cc8dc96d4a4dc8f7b2f2d_6821c4935644a010f5adec3d@conference.…`

```
disco#info           → muc_public, muc_persistent, muc_membersonly, muc_semianonymous, muc_moderated, muc_unsecured
presence join        → <error type="auth"><registration-required/> Membership is required to enter this room
mucsub subscribe     → <error type="auth"><registration-required/> Membership is required to enter this room
```

Both rooms are returned by `GET /v1/chats/my` for this user, with the user in `members`.

## Diagnosis

Two distinct server-side problems, both on QA:

1. **1:1 (private) rooms listed by the API do not exist in ejabberd**, and the MUC service denies creating them (`access_create` / `muc_create` ACL refuses this user). The repo config (`ejabberd-docker/docker/ejabberd.yml`) has `muc_create: allow: local`, i.e. any local user may create rooms, so QA is either running a different config or the user's JID is not matched by `local` there. Either way: rooms missing + creation denied = `forbidden` on join and on MucSub.
2. **Group rooms are `members_only` and the user has no affiliation**, although the backend lists them as the user's chats. ejabberd therefore refuses both the join and the MucSub subscription with `registration-required`.

Nothing on the client changed in this area: `subscribeToRoomMessages.xmpp.js`, `initRoomsPresence.js`, the provider's `subscribeAllRoomsForPush` wiring and the XMPP suspend/reconnect logic are identical in `@ethora/chat-component-rn` 26.7.8 and 26.8.4 (checked against the published tarballs).

## Requests

1. **Reconcile QA ejabberd with the backend DB.** For every chat in the DB that is missing on ejabberd (all the 1:1 rooms above), recreate the persistent room; for every member in the DB, set the matching MUC affiliation (`member` at least) on the room. A one-off script over `chats` + `members` via `mod_muc_admin` (`create_room_with_opts`, `set_room_affiliation`) should cover it.
2. **Confirm the intended policy for room creation on QA.** If clients are expected to lazily create their rooms on first join (as `muc_create: allow: local` suggests), QA's live config must allow it; if room creation is backend-only, then item 1 must run whenever a chat is created, not just as a backfill.
3. **Confirm the `members_only` + affiliation flow.** When a user is added to a chat through the API, the backend should set the affiliation on ejabberd in the same transaction; please check it does on QA (it evidently did not for this account's rooms).
4. **Tell us when QA is fixed** so we can re-run the same probe; the expected result is `type="result"` on the MucSub IQ for all rooms in `/chats/my`, and `MucSub: N rooms subscribed, 0 failed` in the app.

## How to reproduce in 2 minutes

Any XMPP client (the probe used `@xmpp/client` over WSS): log in as the user, send

```xml
<iq to="<room jid>" type="set" id="sub1">
  <subscribe xmlns="urn:xmpp:mucsub:0" nick="<user localpart>">
    <event node="urn:xmpp:mucsub:nodes:messages"/>
  </subscribe>
</iq>
```

for any room from `GET /v1/chats/my`, and read the `<error>` child of the reply.
