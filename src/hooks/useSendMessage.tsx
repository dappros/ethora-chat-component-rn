import { useCallback } from 'react';
import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector, useStore } from 'react-redux';
import { addRoomMessage, setEditAction } from '../roomStore/roomsSlice';
import {
  addMessageToHeap,
  clearMessageFailure,
  markMessageFailed,
} from '../roomStore/roomHeapSlice';
import { uploadFileViaFetch } from '../networking/api-requests/auth.api';
import { enqueueOutboundSend } from '../networking/outboundQueue';
import { RootState } from '../roomStore';
import { useEventHandlers } from './useEventHandlers';
import type { IConfig, IMessage } from '../types/types';

// Watchdog: if a message stays "pending" (no server echo) for this
// long after the optimistic dispatch, mark it failed so the bubble
// flips out of the "sending..." state. Covers the silent-failure
// case (e.g. device offline before the message ever made it to the
// XMPP socket) — bug #18. Tuned generously so a brief network blip
// followed by reconnect within 30s still resolves naturally via the
// server echo.
const PENDING_WATCHDOG_MS = 30_000;

// Monotonic counter for stanza ids. Bumped on each send within a single
// process. Two rapid sends in the same millisecond used to collide on
// `send-text-message-${Date.now()}`; that collision made
// insertMessageWithDelimiter dedup the second optimistic message into
// the first by id, so 10 spam-taps visually collapsed into 1 bubble
// whose body was whatever the last dispatch wrote.
let __sendIdSeq = 0;
const nextStanzaId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${(__sendIdSeq = (__sendIdSeq + 1) >>> 0)}`;

// Hard client-side cap on a single upload. The backend rejects oversized
// bodies with HTTP 413; SendInput blocks oversized files at pick time,
// and this mirrors that limit on every send path (including retries).
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export const useSendMessage = (_configOverride?: IConfig) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();
  // useStore gives us imperative getState() access for the watchdog —
  // peek at the message's current pending/failed state from inside a
  // setTimeout callback without re-rendering on every redux change.
  const reduxStore = useStore<RootState>();

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

      // Silent-failure watchdog (bug #18). If no echo lands within
      // PENDING_WATCHDOG_MS, flip the bubble to "failed → tap to
      // retry". We check at fire-time whether the message is still
      // pending and not already marked failed by the catch path.
      const watchdogTimer = setTimeout(() => {
        const state = reduxStore.getState();
        const roomMsgs = state.rooms?.rooms?.[activeRoomJID]?.messages || [];
        const stillPending = roomMsgs.find(
          (m: any) => m.id === optimisticId && m.pending
        );
        const alreadyFailed = state.roomHeapSlice?.failedMessages?.[optimisticId];
        if (stillPending && !alreadyFailed) {
          console.warn(
            `Send watchdog fired — message ${optimisticId} stuck pending > ${PENDING_WATCHDOG_MS}ms; marking failed`
          );
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
            error: new Error('Send timed out (no server echo)'),
            messageType: 'text',
          });
        }
      }, PENDING_WATCHDOG_MS);

      try {
        if (!client) {
          // No client instance yet (start race, or the full-reinit window
          // after 3 failed reconnects). Don't throw "No XMPP client" and
          // don't fail the bubble — buffer the send and let it replay on
          // the next 'online'. The optimistic message stays pending; the
          // 30s watchdog above still owns the eventual failure if no
          // client ever comes up. (Keep the watchdog armed — do NOT clear.)
          enqueueOutboundSend({
            optimisticId,
            roomJID: activeRoomJID,
            enqueuedAt: Date.now(),
            send: (c) =>
              c.sendMessage(
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
              ),
          });
          return;
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
        clearTimeout(watchdogTimer);
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
    [editAction, client, user, dispatch, handleMessageSent, handleMessageEdited, handleMessageFailed, reduxStore]
  );

  const sendMedia = useCallback(
    async (
      data: any,
      type: string,
      activeRoomJID: string,
      isReply: boolean = false,
      isChecked: boolean = false,
      mainMessage: string = '',
      existingId?: string
    ) => {
      client?.onCriticalSend?.(activeRoomJID);

      // Defensive 50 MB guard on every send path (SendInput blocks it at
      // pick time, but retries replay the saved payload straight here).
      if (typeof data?.size === 'number' && data.size > MAX_MEDIA_BYTES) {
        console.warn('media exceeds 50MB cap — not uploading', {
          name: data?.name,
          size: data?.size,
        });
        if (existingId) {
          dispatch(
            markMessageFailed({
              kind: 'media',
              id: existingId,
              roomJID: activeRoomJID,
              data,
              type,
              isReply,
              isChecked,
              mainMessage,
            })
          );
        }
        handleMessageFailed({
          message: 'media',
          roomJID: activeRoomJID,
          error: new Error('File exceeds the 50 MB upload limit'),
          messageType: 'media',
        });
        return;
      }

      const id = existingId || `send-media-message:${uuidv4()}`;
      const optimisticTimestamp = Date.now();
      const optimisticDate = new Date(optimisticTimestamp).toISOString();
      const selfId =
        (user as any)?.xmppUsername || (user as any)?.walletAddress || '';
      const displayName =
        `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId;
      const fileSizeStr = data?.size != null ? String(data.size) : '';

      if (!config?.disableSentLogic && !existingId) {
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

      // Silent-failure watchdog for media-send (bug #18). Same shape
      // as the text path: if the optimistic bubble never gets the echo
      // (e.g. upload completed but XMPP send is buffered offline), flip
      // to failed → tap to retry.
      const mediaWatchdog = setTimeout(() => {
        const state = reduxStore.getState();
        const roomMsgs = state.rooms?.rooms?.[activeRoomJID]?.messages || [];
        const stillPending = roomMsgs.find(
          (m: any) => m.id === id && m.pending
        );
        const alreadyFailed = state.roomHeapSlice?.failedMessages?.[id];
        if (stillPending && !alreadyFailed) {
          console.warn(
            `Media-send watchdog fired — ${id} stuck pending > ${PENDING_WATCHDOG_MS}ms; marking failed`
          );
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
            error: new Error('Media send timed out (no server echo)'),
            messageType: 'media',
          });
        }
      }, PENDING_WATCHDOG_MS);

      // Help RN's FormData polyfill build a proper multipart/file part
      // (instead of serialising the JS object as JSON). On iOS the
      // picker can return ph:// or assets-library:// URIs for some
      // legacy library items — those can't be read as files. Coerce
      // to a file:// scheme when possible so the body is a real blob.
      const fileBlob = {
        uri:
          typeof data?.uri === 'string'
            ? data.uri.replace(/^assets-library:\/\//, 'file://')
            : data?.uri,
        type:
          data?.type ||
          data?.mimeType ||
          type ||
          'application/octet-stream',
        name: data?.name || data?.fileName || `media_${Date.now()}`,
      };

      // Mirror the web client: a single multipart POST to /files/ with
      // the file under the plural "files" field. We send it via fetch
      // (not axios) because RN's fetch sets the multipart boundary on the
      // Content-Type header correctly. The previous axios fallback omitted
      // a valid boundary, so the server mis-parsed one file as many and
      // rejected the request with HTTP 413 "TOO_MANY_FILES". The only
      // retry is the documented singular-"file" fallback for deployments
      // that 500 on the plural field (bug #10).
      const tryUpload = async () => {
        const fd = new FormData();
        fd.append('files', fileBlob as any);
        try {
          return await uploadFileViaFetch(fd);
        } catch (err: any) {
          if (err?.response?.status === 500) {
            console.warn(
              'upload "files" field returned 500 — retrying with "file" (singular)',
              { name: fileBlob.name, type: fileBlob.type }
            );
            const fd2 = new FormData();
            fd2.append('file', fileBlob as any);
            return await uploadFileViaFetch(fd2);
          }
          throw err;
        }
      };

      try {
        const response = await tryUpload();
        // Upload succeeded — the stanza is now in flight. If the
        // server echo arrives within the watchdog window the bubble
        // flips normally; if not, the watchdog still fires and marks
        // it failed. We don't clear the timer on upload success because
        // the XMPP send could still fail silently.

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
          // When there's no client instance (start / reinit race) buffer
          // the stanza so the already-uploaded file replays on reconnect
          // instead of being lost. When the instance exists,
          // sendMediaMessageStanza self-gates on stream readiness.
          if (client) {
            client.sendMediaMessageStanza(activeRoomJID, messagePayload, id);
          } else {
            enqueueOutboundSend({
              optimisticId: id,
              roomJID: activeRoomJID,
              enqueuedAt: Date.now(),
              send: (c) =>
                c.sendMediaMessageStanza(activeRoomJID, messagePayload, id),
            });
          }
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
        // Upload (or stanza send) threw an explicit error. Clear the
        // watchdog so it doesn't double-fire `markMessageFailed`.
        clearTimeout(mediaWatchdog);
        // Surface the real server payload so we can see why the upload
        // was rejected (axios collapses the message to "Request failed
        // with status code N"; the actual reason lives in
        // `error.response.data`).
        const uriStr = typeof data?.uri === 'string' ? data.uri : '';
        const uriScheme = uriStr.match(/^([a-z]+):/i)?.[1] ?? 'unknown';
        console.error('upload failed', {
          status: error?.response?.status,
          statusText: error?.response?.statusText,
          serverBody: error?.response?.data,
          requestUrl: error?.config?.url,
          axiosMessage: error?.message,
          axiosCode: error?.code,
          axiosCauseMessage: error?.cause?.message,
          uri: uriStr,
          uriScheme,
          mime: fileBlob.type,
          fileSizeBytes: data?.size ?? null,
          fileName: fileBlob.name,
          platformOS: Platform.OS,
          platformVersion: Platform.Version,
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
    [client, config, user, dispatch, handleMessageSent, handleMessageFailed, reduxStore]
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
          payload.mainMessage,
          failedId
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
