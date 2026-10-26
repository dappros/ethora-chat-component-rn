import type { IConfig } from '../types/types';

const normalizeJid = (jid: string): string =>
  jid.trim().split('/')[0].toLowerCase();

/** Ordinary rooms are leaveable; configured app rooms need removable: true. */
export const canLeaveRoom = (
  jid: string | undefined,
  defaultRooms: IConfig['defaultRooms']
): boolean => {
  if (!jid) return true;
  const roomJid = normalizeJid(jid);
  const appRoom = defaultRooms?.find((room) => {
    const configuredJid = typeof room === 'string' ? room : room.jid;
    return normalizeJid(configuredJid) === roomJid;
  });
  return appRoom
    ? typeof appRoom !== 'string' && appRoom.removable === true
    : true;
};
