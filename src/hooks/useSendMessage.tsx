import { useCallback } from 'react';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector } from 'react-redux';
import { addRoomMessage, setEditAction } from '../roomStore/roomsSlice';
import { uploadFile } from '../networking/api-requests/auth.api';
import { RootState } from '../roomStore';
import { useEventHandlers } from './useEventHandlers';
import type { IConfig, IMessage } from '../types/types';

export const useSendMessage = (_configOverride?: IConfig) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  // Split selectors so each returns a primitive/stable reference — the
  // single-object selector above caused a "returned a different result
  // when called with the same parameters" warning and unnecessary
  // rerenders on every redux update.
  const user = useSelector((state: RootState) => state.chatSettingStore.user);
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );
  const editAction = useSelector((state: RootState) => state.rooms.editAction);
  const rooms = useSelector((state: RootState) => state.rooms.rooms);

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

      // Optimistic pending render — push the message into redux
      // immediately with `pending: true` so the bubble shows
      // "sending..." while the stanza is in flight. The server echoes
      // it back with the same id and insertMessageWithDelimiter
      // dedupes by id and flips `pending: false` → DoubleTick renders.
      // Without this, the user taps send and sees nothing for ~200ms
      // until the echo lands, which feels broken.
      const optimisticId = `send-text-message-${Date.now()}`;
      const optimisticDate = new Date().toISOString();
      const selfId =
        (user as any)?.xmppUsername || (user as any)?.walletAddress || '';
      const optimisticMessage: IMessage = {
        id: optimisticId,
        // Also set xmppId so the echo (which carries our outer stanza
        // id as xmppId via getDataFromXml) can be matched and dedup'd
        // by insertMessageWithDelimiter (`msg.xmppId === message.id`
        // branch).
        xmppId: optimisticId,
        body: message,
        roomJid: activeRoomJID,
        date: optimisticDate,
        pending: true,
        isDeleted: false,
        user: {
          ...(user as any),
          id: selfId,
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId,
        } as any,
      } as IMessage;
      if (!config?.disableSentLogic) {
        dispatch(
          addRoomMessage({ roomJID: activeRoomJID, message: optimisticMessage })
        );
      }

      try {
        if (!client) {
          throw new Error('No XMPP client');
        }
        // Pass the optimistic id as the stanza id so the server echoes
        // it back with the same value — the reducer's dedupe lookup
        // matches and the bubble flips from pending → delivered in-place
        // (instead of rendering two copies, which is what happens when
        // ids don't match).
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
          mainMessage || '',
          optimisticId
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

      // Optimistic pending bubble — same pattern as text send. Render
      // a placeholder with `isMediafile: true` so MessageBubble shows
      // a media-shaped pending tile while the upload + send is in
      // flight; replaced in-place by the server echo via xmppId dedupe.
      const optimisticId = `send-media-message-${Date.now()}`;
      const optimisticDate = new Date().toISOString();
      const selfId =
        (user as any)?.xmppUsername || (user as any)?.walletAddress || '';
      const placeholderMessage: IMessage = {
        id: optimisticId,
        xmppId: optimisticId,
        body: 'media',
        roomJid: activeRoomJID,
        date: optimisticDate,
        pending: true,
        isDeleted: false,
        isMediafile: 'true',
        mimetype: type,
        originalName: data?.name,
        user: {
          ...(user as any),
          id: selfId,
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId,
        } as any,
      } as IMessage;
      if (!config?.disableSentLogic) {
        dispatch(
          addRoomMessage({ roomJID: activeRoomJID, message: placeholderMessage })
        );
      }

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
          // Pass optimisticId as the stanza id so the echo's outer
          // id matches our placeholder's xmppId and dedup'es in place.
          client?.sendMediaMessageStanza(activeRoomJID, payload, optimisticId);
          await handleMessageSent({
            message: item.location || '',
            roomJID: activeRoomJID,
            user,
            messageType: 'media',
            metadata: payload,
          });
        });
      } catch (error: any) {
        // Surface the real server payload so we can see why the upload
        // was rejected (axios collapses the message to "Request failed
        // with status code N"; the actual reason lives in
        // `error.response.data`).
        console.error('upload failed', {
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          serverBody: error?.response?.data,
          requestUrl: error?.config?.url,
          axiosMessage: error?.message,
        });
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
