#!/usr/bin/env node
/**
 * TEMP test helper (not for commit): connect to XMPP as a client-JWT user
 * and send N groupchat messages to a MUC room. Used to inject "while-away"
 * messages so the cache-merge gap→clear branch can be exercised live.
 *
 *   node scripts/xmpp-inject.mjs <CLIENT_JWT> <ROOM_JID> <COUNT> [prefix]
 */
import { client, xml } from '@xmpp/client';

const BASE = process.env.ETHORA_API_BASE_URL || 'https://api.chat.ethora.com/v1';
const [, , jwt, roomJid, countArg, prefixArg] = process.argv;
const count = Number(countArg || 1);
const prefix = prefixArg || 'inject';
if (!jwt || !roomJid) {
  console.error('usage: node scripts/xmpp-inject.mjs <JWT> <ROOM_JID> <COUNT> [prefix]');
  process.exit(2);
}

const res = await fetch(`${BASE}/users/client`, {
  method: 'POST',
  headers: { 'x-custom-token': jwt },
});
const data = await res.json();
const u = data?.user || {};
if (!u.xmppUsername || !u.xmppPassword) {
  console.error('inject: missing xmpp creds from /users/client');
  process.exit(3);
}
const domain = roomJid.split('@')[1].replace(/^conference\./, '');
const service = `wss://${domain}/ws`;
console.log(`inject: connecting ${u.xmppUsername} @ ${service}`);

const xmpp = client({ service, domain, username: u.xmppUsername, password: u.xmppPassword });
xmpp.on('error', (err) => console.error('inject: xmpp error:', err?.message || err));

let sent = 0;
xmpp.on('online', async (jid) => {
  console.log('inject: ONLINE as', jid.toString());
  // Join the MUC room.
  await xmpp.send(
    xml('presence', { to: `${roomJid}/${jid.getLocal()}` }, xml('x', { xmlns: 'http://jabber.org/protocol/muc' }))
  );
  await new Promise((r) => setTimeout(r, 800));
  for (let i = 1; i <= count; i++) {
    const body = `${prefix}-${i}`;
    await xmpp.send(
      xml('message', { type: 'groupchat', to: roomJid, id: `${prefix}-${Date.now()}-${i}` }, xml('body', {}, body))
    );
    sent++;
    console.log('inject: sent', body);
    await new Promise((r) => setTimeout(r, 250));
  }
  await new Promise((r) => setTimeout(r, 800));
  await xmpp.stop();
  console.log(`inject: done, sent ${sent}/${count}`);
  process.exit(sent === count ? 0 : 4);
});

await xmpp.start().catch((err) => {
  console.error('inject: start failed (SASL?):', err?.message || err);
  process.exit(5);
});
