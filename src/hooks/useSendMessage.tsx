import { useCallback } from 'react';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector } from 'react-redux';
import { setEditAction } from '../roomStore/roomsSlice';
import { uploadFile } from '../networking/api-requests/auth.api';
import { RootState } from '../roomStore';
import { useEventHandlers } from './useEventHandlers';
import type { IConfig } from '../types/types';

export const useSendMessage = (_configOverride?: IConfig) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const { user, config, editAction, rooms } = useSelector((state: RootState) => ({
    activeRoomJID: state.rooms.activeRoomJID,
    user: state.chatSettingStore.user,
    config: state.chatSettingStore.config,
    editAction: state.rooms.editAction,
    rooms: state.rooms.rooms,
  }));

  const {
    handleMessageSent,
    handleMessageFailed,
    handleMessageEdited,
  } = useEventHandlers(config);

  const sendMessage = useCallback(
    async (
      message: string,
      activeRoomJID: string,
      isReply?: boolean,
      isChecked?: boolean,
      mainMessage?: string
    ) => {
      if (editAction?.isEdit) {
        try {
          client?.editMessageStanza(
            editAction.roomJid!,
            editAction.messageId!,
            message
          );
          handleMessageEdited({
            messageId: editAction.messageId!,
            newMessage: message,
            roomJID: editAction.roomJid!,
            user,
          });
        } catch (error) {
          handleMessageFailed({
            message,
            roomJID: editAction.roomJid!,
            error: error as Error,
            messageType: 'text',
          });
        }
        dispatch(setEditAction({ isEdit: false }));
        return;
      }

      // Critical-send hint to the QoS scheduler.
      client?.onCriticalSend?.(activeRoomJID);

      console.log('🔵 [useSendMessage] sending', {
        room: activeRoomJID,
        hasClient: !!client,
        first: user?.firstName,
        last: user?.lastName,
        wallet: user?.walletAddress,
        len: message?.length,
      });

      try {
        if (!client) {
          throw new Error('No XMPP client');
        }
        client.sendMessage(
          activeRoomJID,
          user.firstName,
          user.lastName,
          '',
          user.walletAddress,
          message,
          '',
          isReply || false,
          isChecked || false,
          mainMessage || ''
        );
        await handleMessageSent({
          message,
          roomJID: activeRoomJID,
          user,
          messageType: 'text',
        });
      } catch (error) {
        handleMessageFailed({
          message,
          roomJID: activeRoomJID,
          error: error as Error,
          messageType: 'text',
        });
      }
    },
    [editAction, client, user, dispatch, handleMessageSent, handleMessageEdited, handleMessageFailed]
  );

  const sendMedia = useCallback(
    async (
      data: any,
      type: string,
      activeRoomJID: string,
      isReply?: boolean,
      isChecked?: boolean,
      mainMessage?: string
    ) => {
      const mediaData = new FormData();
      mediaData.append('files', data);

      client?.onCriticalSend?.(activeRoomJID);

      try {
        const response = await uploadFile(mediaData);
        response.data.results.forEach(async (item: any) => {
          const payload = {
            firstName: user.firstName,
            lastName: user.lastName,
            walletAddress: user.walletAddress,
            createdAt: item.createdAt,
            expiresAt: item.expiresAt,
            fileName: item.filename,
            isVisible: item?.isVisible,
            location: item.location,
            locationPreview: item.locationPreview,
            mimetype: item.mimetype,
            originalName: item?.originalname,
            ownerKey: item?.ownerKey,
            size: item.size,
            duration: item?.duration,
            updatedAt: item?.updatedAt,
            userId: item?.userId,
            attachmentId: item?._id,
            wrappable: true,
            roomJid: activeRoomJID,
            showInChannel: isChecked || false,
            isReply: isReply || false,
            mainMessage: mainMessage || '',
            isPrivate: item?.isPrivate,
            __v: item.__v,
          };
          client?.sendMediaMessageStanza(activeRoomJID, payload);
          await handleMessageSent({
            message: item.location || '',
            roomJID: activeRoomJID,
            user,
            messageType: 'media',
            metadata: payload,
          });
        });
      } catch (error) {
        console.error('Media upload failed', error);
        handleMessageFailed({
          message: '',
          roomJID: activeRoomJID,
          error: error as Error,
          messageType: 'media',
        });
      }
    },
    [client, user, handleMessageSent, handleMessageFailed]
  );

  // ChatRoom/ThreadWrapper consume this as the "edit branch" of send.
  // It mirrors the edit path inside `sendMessage` so callers can wire it
  // up directly when `editAction.isEdit` is true.
  const sendEditMessage = useCallback(
    async (message: string, _activeRoomJID?: string) => {
      if (!editAction?.isEdit || !editAction.roomJid || !editAction.messageId) {
        return;
      }
      try {
        client?.editMessageStanza(
          editAction.roomJid,
          editAction.messageId,
          message
        );
        handleMessageEdited({
          messageId: editAction.messageId,
          newMessage: message,
          roomJID: editAction.roomJid,
          user,
        });
      } catch (error) {
        handleMessageFailed({
          message,
          roomJID: editAction.roomJid,
          error: error as Error,
          messageType: 'text',
        });
      }
      dispatch(setEditAction({ isEdit: false }));
    },
    [client, editAction, user, dispatch, handleMessageEdited, handleMessageFailed]
  );

  // True when the most recent message in the given room is from the
  // current user and still in a pending state (i.e. not yet ack'd by
  // the server). Used by SendInput to disable rapid re-sends.
  const isLastMessageFromUserAndProcessing = useCallback(
    (roomJID: string): boolean => {
      if (!roomJID) {return false;}
      const msgs = rooms?.[roomJID]?.messages;
      if (!msgs || msgs.length === 0) {return false;}
      const last = msgs[msgs.length - 1];
      if (!last?.pending) {return false;}
      const selfId = user?.xmppUsername || user?.walletAddress;
      if (!selfId) {return false;}
      return last.user?.id === selfId;
    },
    [rooms, user?.xmppUsername, user?.walletAddress]
  );

  return {
    sendMessage,
    sendMedia,
    sendEditMessage,
    isLastMessageFromUserAndProcessing,
  };
};
