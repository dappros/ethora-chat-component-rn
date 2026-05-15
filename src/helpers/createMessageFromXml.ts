import { IMessage } from '../types/types';

interface IMessageWithNewData extends IMessage {
  [x: string]: any;
}

export const createMessageFromXml = async (
  data: IMessageWithNewData
): Promise<IMessage> => {
  if (!data) {
    console.log('Invalid arguments: data, id, and roomJid are required.');
  }

  // Spread top-level + the inner XML `data` attrs (senderFirstName /
  // senderLastName / senderJID / fullName / etc.) so they land flat on
  // the message.
  const merged: any = {
    ...data,
    ...data?.data,
    isDeleted: !!data?.deleted || !!(data as any)?.isDeleted,
  };

  // Populate `user.name` from the sender attrs that came in via
  // <data .../>. getDataFromXml only sets {id, photoURL}; without a
  // name, every message bubble renders with the "??" avatar fallback.
  // Web compensates by reading usersSet from redux in <Message>; we
  // fix it once at the source so the data is right wherever it's read.
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
