import { useCallback } from 'react';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector } from 'react-redux';
import { setEditAction } from '../roomStore/roomsSlice';
import { uploadFile } from '../networking/api-requests/auth.api';
import { RootState } from '../roomStore';
import { useEventHandlers } from './useEventHandlers';

export const useSendMessage = () => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const { user, config, editAction } = useSelector((state: RootState) => ({
    activeRoomJID: state.rooms.activeRoomJID,
    user: state.chatSettingStore.user,
    config: state.chatSettingStore.config,
    editAction: state.rooms.editAction,
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

      try {
        client?.sendMessage(
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

  return { sendMessage, sendMedia };
};
