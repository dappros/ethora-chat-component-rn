import { useCallback } from 'react';
import { Alert } from 'react-native';
import { store } from '../roomStore';
import {
  blockUser,
  getRooms,
  postReportRoom,
  unblockUser,
} from '../networking/api-requests/rooms.api';
import { addBlockedUserId, removeBlockedUserId } from '../roomStore/chatSettingsSlice';
import { deleteRoom, setCurrentRoom } from '../roomStore/roomsSlice';
import { blockAccountOf, blockedIdOf, isPrivateRoomWithBlockedPeer } from '../helpers/userBlock';
import { useToast } from '../context/ToastContext';
import { useT } from '../i18n/useT';
import type { IRoom } from '../types/types';

export interface BlockTarget {
  /** The other user's xmppUsername (or a JID with it as the local part) */
  xmppUsername: string;
  /** For the report the moderators get */
  name?: string;
  /** Where the user met them (a group chat): reported when there is no private chat */
  roomJid?: string;
}

/**
 * Blocking another user (config.features.userBlock), from a profile or a chat
 * profile. App Review guideline 1.2: blocking removes the user's content from
 * the feed at once and notifies the app's moderators.
 */
export const useBlockUser = () => {
  const t = useT();
  const { showToast } = useToast();

  const toast = useCallback(
    (type: 'success' | 'error', message: string) =>
      showToast({
        id: Date.now().toString(),
        title: t(type === 'success' ? 'toast.successTitle' : 'toast.error'),
        message,
        type,
      }),
    [showToast, t]
  );

  const block = useCallback(
    async (target: BlockTarget): Promise<boolean> => {
      const peer = blockAccountOf(
        target.xmppUsername,
        store.getState().chatSettingStore.user?.xmppUsername
      );
      try {
        await blockUser(peer);
      } catch (error) {
        console.warn('[ethora-rn] block user failed', error);
        toast('error', t('toast.blockFailed'));
        return false;
      }

      const blockedId = blockedIdOf(peer);
      store.dispatch(addBlockedUserId(blockedId));

      // Their private chats leave the list now, not at the next /chats/my
      const state = store.getState();
      const ownXmppUsername = state.chatSettingStore.user?.xmppUsername || '';
      const privateRooms = (Object.values(state.rooms.rooms || {}) as IRoom[]).filter((room) =>
        isPrivateRoomWithBlockedPeer(room as any, [blockedId], ownXmppUsername)
      );
      if (privateRooms.some((room) => room.jid === state.rooms.activeRoomJID)) {
        store.dispatch(setCurrentRoom({ roomJID: null }));
      }
      privateRooms.forEach((room) => store.dispatch(deleteRoom({ jid: room.jid })));

      // Tell the moderators (the report e-mail of POST /v1/chats/reports)
      const reportRoomJid = privateRooms[0]?.jid || target.roomJid;
      if (reportRoomJid) {
        const who = target.name ? `${target.name} (${peer})` : peer;
        postReportRoom({
          chatName: reportRoomJid.split('@')[0],
          category: 'other',
          text: `Blocked user: ${who}`,
        }).catch((error) => console.warn('[ethora-rn] block report failed', error));
      }

      toast('success', t('toast.blockedSuccess'));
      return true;
    },
    [t, toast]
  );

  /** Asks first; resolves true once the user is blocked */
  const confirmBlock = useCallback(
    (target: BlockTarget): Promise<boolean> =>
      new Promise((resolve) => {
        Alert.alert(
          t('modal.block.title'),
          t('modal.block.message'),
          [
            { text: t('action.cancel'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('action.block'), style: 'destructive', onPress: () => void block(target).then(resolve) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) }
        );
      }),
    [block, t]
  );

  const unblock = useCallback(
    async (xmppUsername: string): Promise<boolean> => {
      try {
        await unblockUser(
          blockAccountOf(xmppUsername, store.getState().chatSettingStore.user?.xmppUsername)
        );
      } catch (error) {
        console.warn('[ethora-rn] unblock user failed', error);
        toast('error', t('toast.unblockFailed'));
        return false;
      }
      store.dispatch(removeBlockedUserId(blockedIdOf(xmppUsername)));
      // Bring their private chats back
      void getRooms();
      return true;
    },
    [t, toast]
  );

  return { confirmBlock, unblock };
};
