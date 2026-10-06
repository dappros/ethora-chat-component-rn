import type { Client } from '@xmpp/client';
import type { Element } from 'ltx';
import {
  accountDomain,
  isE2eeEnabled,
  isE2eeRoom,
  omemoReady,
  resolveRecipients,
} from './index';

export function shouldEncrypt(roomJID: string): boolean {
  return isE2eeEnabled() && isE2eeRoom(roomJID);
}

let queue: Promise<void> = Promise.resolve();

export function sendEncrypted(
  client: Client,
  roomJID: string,
  id: string,
  data: Element,
  body: Element,
  plain: Element
): void {
  queue = queue.then(async () => {
    let stanza = plain;
    try {
      const crypto = await omemoReady();
      if (!crypto) {throw new Error('omemo_not_ready');}
      const recipients = await resolveRecipients(roomJID, accountDomain(client));
      stanza = await crypto.encryptGroupMessage(roomJID, recipients, [body], id, [data]);
    } catch (error) {
      const reason = String((error as Error)?.message || error);
      if (reason.startsWith('omemo_members_unknown')) {
        console.warn(`OMEMO: not sending to ${roomJID} - ${reason}`);
        return;
      }
      console.warn(`OMEMO: sending to ${roomJID} in clear - ${reason}`);
    }
    try {
      await client.send(stanza);
    } catch (error) {
      console.error('An error occurred while sending message:', error);
    }
  });
}

export function sendSealedMedia(
  client: Client,
  roomJID: string,
  id: string,
  body: Element,
  cleartext: Element[]
): void {
  queue = queue.then(async () => {
    try {
      const crypto = await omemoReady();
      if (!crypto) {throw new Error('omemo_not_ready');}
      const recipients = await resolveRecipients(roomJID, accountDomain(client));
      const stanza = await crypto.encryptGroupMessage(roomJID, recipients, [body], id, cleartext);
      await client.send(stanza);
    } catch (error) {
      console.error(
        `OMEMO: refusing to send sealed attachment to ${roomJID} - ${String(
          (error as Error)?.message || error
        )}`
      );
    }
  });
}
