import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector } from 'react-redux';
import { addRoomMessage, setEditAction } from '../roomStore/roomsSlice';
import {
  addMessageToHeap,
  clearMessageFailure,
  markMessageFailed,
} from '../roomStore/roomHeapSlice';
import { uploadFile } from '../networking/api-requests/auth.api';
import { RootState } from '../roomStore';
import { useEventHandlers } from './useEventHandlers';
import type { IConfig, IMessage } from '../types/types';

// Monotonic counter for stanza ids. Bumped on each send within a single
// process. Two rapid sends in the same millisecond used to collide on
// `send-text-message-${Date.now()}`; that collision made
// insertMessageWithDelimiter dedup the second optimistic message into
// the first by id, so 10 spam-taps visually collapsed into 1 bubble
// whose body was whatever the last dispatch wrote.
let __sendIdSeq = 0;
const nextStanzaId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${(__sendIdSeq = (__sendIdSeq + 1) >>> 0)}`;

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
    handleMessageRetry,
  } = useEventHandlers(config);

  const failedMessages = useSelector(
    (state: RootState) => state.roomHeapSlice?.failedMessages || {}
  );

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
      const optimisticId = nextStanzaId('send-text-message');
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
        dispatch(
          markMessageFailed({
            kind: 'text',
            id: optimisticId,
            roomJID: activeRoomJID,
            body: message,
            isReply,
            isChecked,
            mainMessage,
          })
        );
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
      isReply: boolean = false,
      isChecked: boolean = false,
      mainMessage: string = ''
    ) => {
      client?.onCriticalSend?.(activeRoomJID);

      const id = `send-media-message:${uuidv4()}`;
      const optimisticTimestamp = Date.now();
      const optimisticDate = new Date(optimisticTimestamp).toISOString();
      const selfId =
        (user as any)?.xmppUsername || (user as any)?.walletAddress || '';
      const displayName =
        `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId;
      const fileSizeStr = data?.size != null ? String(data.size) : '';

      if (!config?.disableSentLogic) {
        dispatch(
          addRoomMessage({
            roomJID: activeRoomJID,
            message: {
              id: id,
              body: 'media',
              roomJid: activeRoomJID,
              date: optimisticDate,
              messageTimestampMs: optimisticTimestamp,
              user: {
                ...(user as any),
                id: selfId,
                name: displayName,
              },
              pending: true,
              isDeleted: false,
              xmppId: id,
              xmppFrom: `${activeRoomJID}/${selfId}`,
              isSystemMessage: 'false',
              isMediafile: 'true',
              fileName: data?.name,
              location: '',
              locationPreview: '',
              mimetype: type,
              originalName: data?.name,
              size: fileSizeStr,
              isReply,
              showInChannel: `${isChecked}`,
              mainMessage,
            } as any as IMessage,
          })
        );
        dispatch(
          addMessageToHeap({
            id: id,
            user: {
              ...(user as any),
              id: selfId,
              name: displayName,
            },
            date: optimisticDate,
            messageTimestampMs: optimisticTimestamp,
            body: 'media',
            roomJid: activeRoomJID,
            xmppFrom: `${activeRoomJID}/${selfId}`,
            isReply,
            showInChannel: `${isChecked}` as any,
            mainMessage,
          } as any as IMessage)
        );
      }

      try {
        const mediaData = new FormData();
        mediaData.append('files', data);

        const response = await uploadFile(mediaData);

        for (const item of response.data.results) {
          const messagePayload = {
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
            showInChannel: isChecked,
            isReply,
            mainMessage,
            isPrivate: item?.isPrivate,
            __v: item.__v,
          };
          // Stanza id == placeholder id so the MUC echo's outer
          // <message id="..."> matches xmppId on the placeholder and
          // insertMessageWithDelimiter merges in place + flips pending.
          client?.sendMediaMessageStanza(activeRoomJID, messagePayload, id);
        }

        await handleMessageSent({
          message: 'media',
          roomJID: activeRoomJID,
          user,
          messageType: 'media',
          metadata: {
            isReply,
            isChecked,
            mainMessage,
            fileData: data,
            fileType: type,
            messageId: id,
            uploadResults: response.data.results,
          },
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
        dispatch(
          markMessageFailed({
            kind: 'media',
            id,
            roomJID: activeRoomJID,
            data,
            type,
            isReply,
            isChecked,
            mainMessage,
          })
        );
        handleMessageFailed({
          message: 'media',
          roomJID: activeRoomJID,
          error: error as Error,
          messageType: 'media',
        });
      }
    },
    [client, config, user, dispatch, handleMessageSent, handleMessageFailed]
  );

  // Retry a previously-failed send by replaying the saved payload from
  // the heap. Clears the failure flag first so the bubble flips back to
  // "sending..."; if the retry fails again `markMessageFailed` re-arms
  // it. No-op when the id isn't in the failed map.
  const retryMessage = useCallback(
    async (failedId: string) => {
      const payload = failedMessages[failedId];
      if (!payload) {return;}
      dispatch(clearMessageFailure(failedId));
      handleMessageRetry({
        messageId: failedId,
        roomJID: payload.roomJID,
        messageType: payload.kind,
      });
      if (payload.kind === 'text') {
        await sendMessage(
          payload.body,
          payload.roomJID,
          payload.isReply,
          payload.isChecked,
          payload.mainMessage
        );
      } else {
        await sendMedia(
          payload.data,
          payload.type,
          payload.roomJID,
          payload.isReply,
          payload.isChecked,
          payload.mainMessage
        );
      }
    },
    [failedMessages, dispatch, handleMessageRetry, sendMessage, sendMedia]
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
    retryMessage,
    isLastMessageFromUserAndProcessing,
  };
};
