import { FC, useCallback } from 'react';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector } from 'react-redux';
import { addRoomMessage, setEditAction } from '../roomStore/roomsSlice';
import { uploadFile } from '../networking/api-requests/auth.api';
import { RootState } from '../roomStore';
import { useChatSettingState } from './useChatSettingState';
import {Iso639_1Codes} from "../types/types.ts";

export const useSendMessage = () => {
  const { config, langSource } = useChatSettingState();
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const {
    user,
    // activeRoomJID,
    editAction,
  } = useSelector((state: RootState) => ({
    activeRoomJID: state.rooms.activeRoomJID,
    user: state.chatSettingStore.user,
    editAction: state.rooms.editAction,
    config: state.chatSettingStore.config,
  }));

  const sendMessage = useCallback(
    (
      message: string,
      activeRoomJID: string,
      isReply?: boolean,
      isChecked?: boolean,
      mainMessage?: string
    ) => {
      if (editAction && editAction.isEdit) {
        client?.editMessageStanza(
          editAction.roomJid,
          editAction.messageId,
          message
        );

        dispatch(setEditAction({ isEdit: false }));
        return;
      } else {
        console.log('config?.enableTranslates 1', config?.enableTranslates)
        if (config?.enableTranslates) {
          console.log('config?.enableTranslates 2', config?.enableTranslates)
          client?.sendTextMessageWithTranslateTagStanza(
            activeRoomJID,
            user.firstName,
            user.lastName,
            '',
            user.walletAddress,
            message,
            '',
            isReply || false,
            isChecked || false,
            mainMessage || '',
            config?.enableTranslates as Iso639_1Codes || 'en'
          );
        } else {
          const id = `send-text-message-${Date.now().toString()}`;

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
            mainMessage || '',
          );
        }
      }
    },
    [editAction]
  );

  const sendEditMessage = useCallback(
    (message: string) => {
      client?.editMessageStanza(
        editAction.roomJid,
        editAction.messageId,
        message
      );

      dispatch(setEditAction({ isEdit: false }));
      return;
    },
    [editAction]
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
      let mediaData: FormData | null = new FormData();
      mediaData.append('files', data);

      uploadFile(mediaData)
        .then((response) => {
          console.log('Upload successful', response);
          response.data.results.map(async (item: any) => {
            const data = {
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
            client?.sendMediaMessageStanza(activeRoomJID, data);
          });
        })
        .catch((error) => {
          console.error('Upload failed', error);
        });
    },
    [client]
  );

  return {
    sendMessage,
    sendMedia,
    sendEditMessage,
  };
};
