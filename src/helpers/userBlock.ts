import type { IConfig } from '../types/types';

export const isUserBlockEnabled = (config?: IConfig): boolean =>
  config?.features?.userBlock === true && !config?.disableUserBlock;

export const blockedIdOf = (xmppUsernameOrJid?: string | null): string =>
  String(xmppUsernameOrJid || '').split('@')[0].split('_').pop() || '';

export const blockAccountOf = (peer: string, ownXmppUsername?: string | null): string => {
  const local = String(peer || '').split('@')[0];
  if (!local || local.includes('_')) {return local;}
  const own = String(ownXmppUsername || '').split('@')[0];
  const appId = own.includes('_') ? own.split('_')[0] : '';
  return appId ? `${appId}_${local}` : local;
};

interface MemberLike {
  xmppUsername?: string;
  _id?: string;
}

export const privateRoomPeer = (
  room: { type?: string; members?: any[]; roomMembers?: any[] } | undefined,
  ownXmppUsername?: string
): { xmppUsername: string; name?: string } | undefined => {
  if (!room || room.type !== 'private') {return undefined;}
  const own = blockedIdOf(ownXmppUsername);
  const peer = [...(room.members || []), ...(room.roomMembers || [])].find((m) => {
    const id = blockedIdOf(m?.xmppUsername || m?._id);
    return !!id && id !== own;
  });
  const xmppUsername = String(peer?.xmppUsername || peer?._id || '').split('@')[0];
  if (!xmppUsername) {return undefined;}
  const name = [peer?.firstName, peer?.lastName].filter(Boolean).join(' ') || peer?.name || '';
  return { xmppUsername, name: name || undefined };
};

export const isPrivateRoomWithBlockedPeer = (
  room: { type?: string; members?: MemberLike[]; roomMembers?: MemberLike[] } | undefined,
  blockedIds: string[] | undefined,
  ownXmppUsername: string
): boolean => {
  if (!room || room.type !== 'private' || !blockedIds?.length) {return false;}
  const own = blockedIdOf(ownXmppUsername);
  return [...(room.members || []), ...(room.roomMembers || [])].some((m) => {
    const id = blockedIdOf(m?.xmppUsername || m?._id);
    return !!id && id !== own && blockedIds.includes(id);
  });
};
