import { IMessage } from '../types/types';

interface IMessageWithNewData extends IMessage {
  [x: string]: any;
}

/**
 * Build an IMessage from XML.
 *
 * Two calling conventions are supported:
 *
 * 1. **Wrapped (used by getHistory.xmpp.ts)**:
 *      createMessageFromXml({ data, id, body, roomJid, date, user, ...rest })
 *    where `data` is the inner XML `<data>` element's attrs.
 *
 * 2. **Positional (used by onRealtimeMessage / onMessageHistory)**:
 *      createMessageFromXml(dataAttrs, bodyElement, id, fromJid, deleted)
 *
 * Both fan into the same merge logic that flattens senderFirstName /
 * senderLastName / senderJID into `user.{name, firstName, lastName, id}`.
 */
export const createMessageFromXml = async (
  arg: IMessageWithNewData,
  bodyEl?: any,
  positionalId?: string,
  positionalFrom?: string,
  positionalDeleted?: boolean
): Promise<IMessage> => {
  if (!arg) {
    console.log('createMessageFromXml: arg is required.');
    // Return a stub so callers don't crash; the reducer will discard
    // messages without a usable id/date anyway.
    return { id: '', body: '', date: '', user: { id: '', name: '' } as any, roomJid: '' } as IMessage;
  }

  // Detect positional vs wrapped. Wrapped always has a top-level
  // `data` key holding the flat attrs; positional passes the attrs
  // directly so `arg.data` is undefined.
  const isPositional = bodyEl !== undefined || positionalId !== undefined;

  let inner: any; // flat XML <data> attrs
  let outerExtras: any = {};

  if (isPositional) {
    inner = arg; // arg IS the dataAttrs in this convention
    const bodyText =
      typeof bodyEl === 'string'
        ? bodyEl
        : bodyEl?.getText
          ? bodyEl.getText()
          : bodyEl?.text;
    outerExtras = {
      id: positionalId,
      body: bodyText,
      roomJid: (positionalFrom || '').split('/')[0],
      xmppFrom: positionalFrom,
      deleted: !!positionalDeleted,
    };
  } else {
    inner = arg?.data || {};
    outerExtras = { ...arg };
    delete outerExtras.data;
  }

  const merged: any = {
    ...inner,
    ...outerExtras,
    isDeleted: !!outerExtras?.deleted || !!(arg as any)?.isDeleted,
  };

  // Date fallback: when called via the realtime path, the stanza may
  // not carry a date attr — derive it from the message id (server
  // timestamps are encoded in the stanza-id microseconds prefix), and
  // ultimately fall back to "now" so the reducer's date-based ordering
  // doesn't crash on `undefined.toString()`.
  if (!merged.date) {
    const numericPart = /\d{13,}/.exec(String(merged.id || ''))?.[0];
    merged.date = numericPart
      ? new Date(+numericPart.slice(0, 13)).toISOString()
      : new Date().toISOString();
  }
  if (!merged.id) {
    merged.id = String(Date.now());
  }

  // Synthesize user.name from sender attrs (web reads usersSet from
  // redux in <Message>; we fix it once at the source so Avatar /
  // MessageHeader render the actual sender instead of "??").
  const firstName = (merged.senderFirstName || '').toString().trim();
  const lastName = (merged.senderLastName || '').toString().trim();
  const fullName = (merged.fullName || '').toString().trim();
  const senderJID = (merged.senderJID || '').toString();
  const senderLocal = senderJID.includes('@')
    ? senderJID.split('@')[0]
    : senderJID;
  const composed = [firstName, lastName].filter(Boolean).join(' ').trim();
  const existingName = String(merged?.user?.name || '').trim();
  const resolvedName =
    existingName ||
    composed ||
    fullName ||
    senderLocal ||
    merged?.user?.id ||
    '';

  const message: IMessage = {
    ...merged,
    user: {
      ...(merged.user || {}),
      id: merged?.user?.id || senderLocal,
      name: resolvedName,
      firstName: firstName || merged?.user?.firstName,
      lastName: lastName || merged?.user?.lastName,
    },
  };

  return message;
};
