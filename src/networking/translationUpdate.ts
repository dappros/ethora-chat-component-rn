import type { Element } from 'ltx';
import { store } from '../roomStore';
import { applyTranslationUpdate } from '../roomStore/roomsSlice';
import {
  parseTranslationsValue,
  TRANSLATE_NS,
} from '../helpers/transformTranslatations';

/**
 * The translation of a room message, sent after the message itself.
 *
 * mod_translate in async mode delivers a room message at once, marked
 * `<translation-pending/>` (the bubble shows "Translating…"), and once the
 * translation service answers it writes the translation into the archive and
 * sends each occupant online in the room:
 *
 *   <message type="headline" from="room@conference.host">
 *     <translation-update xmlns="ethora:translate" id="ARCHIVE_ID"
 *         xmppId="SENDER_ID" status="done" value="TRANSLATIONS_JSON"/>
 *   </message>
 *
 * `status="failed"` (no value) means none is coming. A reader who misses the
 * update (offline at the time) gets the translation from the archive.
 *
 * Returns true when the stanza is such an update, handled or ignored.
 */
export const onTranslationUpdate = (stanza: Element): boolean => {
  if (stanza?.name !== 'message' || stanza.attrs?.type !== 'headline') {
    return false;
  }
  const update = stanza.getChild?.('translation-update', TRANSLATE_NS);
  if (!update) {return false;}

  // Only the room itself sends it (a bare room jid). Anything else, an
  // occupant or another user, is not to be trusted with a room's messages.
  const roomJID = String(stanza.attrs?.from || '');
  if (!roomJID || roomJID.includes('/')) {return true;}
  if (!store.getState().rooms?.rooms?.[roomJID]) {return true;}

  const ids = [update.attrs?.id, update.attrs?.xmppId].filter(
    (value): value is string => typeof value === 'string' && value !== ''
  );
  if (!ids.length) {return true;}

  const translations =
    update.attrs?.status === 'done'
      ? parseTranslationsValue(update.attrs?.value)
      : undefined;

  store.dispatch(
    applyTranslationUpdate({
      roomJID,
      ids,
      translations,
      receivedAt: Date.now(),
    })
  );
  return true;
};
