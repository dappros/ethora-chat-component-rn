import { useCallback } from 'react';
import { Platform } from 'react-native';
import { v4 as uuidv4 } from 'uuid';
import { useXmppClient } from '../context/xmppProvider';
import { useDispatch, useSelector, useStore } from 'react-redux';
import {
  addRoomMessage,
  setEditAction,
  setMediaUploadState,
  setMessageAttachments,
} from '../roomStore/roomsSlice';
import {
  addMessageToHeap,
  clearMessageFailure,
  markMessageFailed,
} from '../roomStore/roomHeapSlice';
import type { FailedMediaFile, FailedMessagePayload } from '../roomStore/roomHeapSlice';
import { uploadFileV2 } from '../networking/api-requests/auth.api';
import { enqueueOutboundSend, removeOutboundSend } from '../networking/outboundQueue';
import { RootState, store } from '../roomStore';
import { getGlobalXmppClient } from '../utils/clientRegistry';
import { useEventHandlers } from './useEventHandlers';
import type { IAttachment, IConfig, IMessage } from '../types/types';
import { canEditMessage, canSendMediaToRoom, canSendToRoom } from '../e2ee';
import { shouldEncrypt } from '../e2ee/send';
import type { SealedUpload } from '../e2ee/sealedFiles';
import { MAX_SEAL_BYTES } from '../e2ee/limits';
import { mapWithConcurrency } from '../helpers/mapWithConcurrency';
import { normalizeCaptionInput, type CaptionInput } from '../helpers/caption';
import { toUploadedAttachment } from '../helpers/attachments';
import { mediaFileCap, mediaSizeLimit } from '../helpers/mediaLimits';
import {
  hasMediaRetry,
  registerMediaRetry,
  retryMediaSend,
  unregisterMediaRetry,
} from '../helpers/mediaSendRetry';

// Watchdog: if a message stays "pending" (no server echo) for this
// long after the optimistic dispatch, mark it failed so the bubble
// flips out of the "sending..." state. Covers the silent-failure
// case (e.g. device offline before the message ever made it to the
// XMPP socket) — bug #18.
//
// 10s window: a brief network blip that reconnects inside this window
// still resolves on its own — the offline send is buffered in the
// outbound queue (OUTBOUND_QUEUE_TTL_MS, kept in lockstep) and replayed
// the moment the stream comes back, so the server echo flips the bubble
// to delivered. Only a drop that outlasts 10s flips it to "Failed → tap
// to retry". If a slow send completes just after the window, the
// delivery clears the failed flag (see newMessageMidlleware) so it
// doesn't get stuck showing "Failed".
const PENDING_WATCHDOG_MS = 10_000;

// Media gets a longer window than text: the optimistic bubble appears before
// the file upload even starts, and a large file (up to the 50MB cap) over a
// slow link can legitimately take far longer than 10s to upload + send. Failing
// it at 10s mid-upload would flash a wrong "Failed" and let the user kick off a
// duplicate upload.
const MEDIA_PENDING_WATCHDOG_MS = 30_000;

// Monotonic counter for stanza ids. Bumped on each send within a single
// process. Two rapid sends in the same millisecond used to collide on
// `send-text-message-${Date.now()}`; that collision made
// insertMessageWithDelimiter dedup the second optimistic message into
// the first by id, so 10 spam-taps visually collapsed into 1 bubble
// whose body was whatever the last dispatch wrote.
let __sendIdSeq = 0;
const nextStanzaId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${(__sendIdSeq = (__sendIdSeq + 1) >>> 0)}`;

// Uploads in flight per send. A sealed (e2ee) file is encrypted on the device
// before it goes up, which is slow, so an e2ee send runs fewer at once.
const MEDIA_UPLOAD_CONCURRENCY = 4;
const MEDIA_E2EE_UPLOAD_CONCURRENCY = 2;

/** The local id of a tile until the upload gives it the server's `_id`. */
const localAttachmentId = (messageId: string, index: number): string =>
  `${messageId}:${index}`;

/** A tile without its local upload state (the file itself is unchanged). */
const withoutUploadState = (attachment: IAttachment): IAttachment => {
  const copy: IAttachment = { ...attachment };
  delete copy.uploadStatus;
  delete copy.uploadProgress;
  return copy;
};

/** A picker uri as a plain file uri (iOS asset-library scheme rewritten). */
const normalizeFileUri = (uri: unknown): string =>
  typeof uri === 'string' ? uri.replace(/^assets-library:\/\//, 'file://') : '';

/** The file's own uri when it is on this device, for the sender's preview. */
const localPreviewUrl = (uri: unknown): string | undefined => {
  const normalized = normalizeFileUri(uri);
  return /^(file|content):\/\//.test(normalized) ? normalized : undefined;
};

/** One file as a failed send keeps it: plain fields only, so it persists. */
const toFailedFile = (file: any, fallbackType: string): FailedMediaFile => ({
  uri: typeof file?.uri === 'string' ? file.uri : undefined,
  type: file?.type || file?.mimeType || fallbackType || undefined,
  name: file?.name || file?.fileName || undefined,
  ...(typeof file?.size === 'number' ? { size: file.size } : {}),
  ...(typeof file?.duration === 'number' ? { duration: file.duration } : {}),
  ...(typeof file?.waveForm === 'string' ? { waveForm: file.waveForm } : {}),
});

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
  // The sender's own language, driven by the header globe picker (or the
  // host via config.translates.readerLocale). Declared on every outgoing
  // message as `<translate source>` so the backend can translate it for
  // readers in other languages (see sendTextMessageWithTranslateTagStanza).
  // Mirrors the web SDK, which always sends through the translate-tag path.
  const langSource = useSelector(
    (state: RootState) => state.chatSettingStore.langSource
  );
  const editAction = useSelector((state: RootState) => state.rooms.editAction);

  const {
    handleMessageSent,
    handleMessageFailed,
    handleMessageEdited,
    handleMessageRetry,
  } = useEventHandlers(config);

  const sendMessage = useCallback(
    async (
      message: string,
      activeRoomJID: string,
      isReply?: boolean,
      isChecked?: boolean,
      mainMessage?: string,
      // Set by retryMessage to the failed message's own id. When present we
      // re-use that id (and its existing optimistic bubble) instead of minting
      // a fresh one — mirroring sendMedia's `existingId`. Without this, a text
      // retry created a second bubble while the original stayed pending
      // forever, so a failed message that the user retried showed as two
      // bubbles, one stuck on "sending...".
      existingId?: string
    ) => {
      if (editAction?.isEdit) {
        const edited = reduxStore
          .getState()
          .rooms?.rooms?.[editAction.roomJid!]?.messages?.find(
            (m: IMessage) => m.id === editAction.messageId
          );
        if (edited && !canEditMessage(edited)) {
          console.warn('edit not sent: the message was encrypted');
          dispatch(setEditAction({ isEdit: false }));
          return;
        }
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

      if (!canSendToRoom(activeRoomJID)) {
        console.warn('message not sent: room is end-to-end encrypted');
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
      const optimisticId = existingId || nextStanzaId('send-text-message');
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
        // Declare the sender's language on their own optimistic bubble so
        // manual-mode readers see the Translate link on it too (parity with
        // the web SDK, which stamps langSource on the optimistic message).
        langSource: (langSource as any) || 'en',
        // Reply fields as the wire carries them (strings), so a thread reply
        // shows in its thread — and NOT in the channel — from the first
        // frame, not only once the server echo lands.
        ...(isReply
          ? {
              isReply: 'true',
              showInChannel: isChecked ? 'true' : 'false',
              mainMessage,
            }
          : {}),
        user: {
          ...(user as any),
          id: selfId,
          name: `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId,
        } as any,
        // Thread replies: without these the optimistic copy has no
        // mainMessage, so it shows in the channel instead of the thread
        // until the echo lands.
        ...(isReply
          ? {
              isReply: 'true' as any,
              showInChannel: (isChecked ? 'true' : 'false') as any,
              mainMessage: mainMessage || '',
            }
          : {}),
      } as IMessage;
      // On retry (`existingId`) the original optimistic bubble is still in
      // the room (pending:true) — clearMessageFailure just flipped it back out
      // of the "failed" state — so re-adding would duplicate it. Only push a
      // fresh bubble for a brand-new send.
      if (!config?.disableSentLogic && !existingId) {
        dispatch(
          addRoomMessage({ roomJID: activeRoomJID, message: optimisticMessage })
        );
      }

      // Silent-failure watchdog (bug #18). If no echo lands within
      // PENDING_WATCHDOG_MS, flip the bubble to "failed → tap to
      // retry". We check at fire-time whether the message is still
      // pending and not already marked failed by the catch path.
      // One-shot extension for the case below. Declared outside the
      // timer so the rescheduled run can't extend again.
      let watchdogExtended = false;
      const runWatchdog = () => {
        const state = reduxStore.getState();
        const roomMsgs = state.rooms?.rooms?.[activeRoomJID]?.messages || [];
        const stillPending = roomMsgs.find(
          (m: any) => m.id === optimisticId && m.pending
        );
        const alreadyFailed = state.roomHeapSlice?.failedMessages?.[optimisticId];

        // Don't call it a failure while the stream is still coming back.
        // A reconnect tears the old client down and builds a new one, and
        // any echo in flight during that window is simply lost — the
        // message may well have been delivered (it has been observed
        // arriving twice on the receiving side). Failing it here shows a
        // red "tap to retry" under a message that actually went through.
        // Give the reconnect one more window to produce an echo, once.
        const streamOnline = getGlobalXmppClient()?.status === 'online';
        if (stillPending && !alreadyFailed && !streamOnline && !watchdogExtended) {
          watchdogExtended = true;
          console.warn(
            `Send watchdog — ${optimisticId} still pending but the stream is not online; extending one window`
          );
          watchdogTimer = setTimeout(runWatchdog, PENDING_WATCHDOG_MS);
          return;
        }

        if (stillPending && !alreadyFailed) {
          console.warn(
            `Send watchdog fired — message ${optimisticId} stuck pending > ${PENDING_WATCHDOG_MS}ms; marking failed`
          );
          // Drop the buffered replay now that the bubble is showing
          // "failed / tap to retry" — a later onOnline flush must not
          // silently resend it behind the user's back. If the original
          // send actually lands after this point, the server echo still
          // flips the bubble back to delivered (newMessageMidlleware);
          // only an explicit tap-to-retry should trigger another send.
          removeOutboundSend(optimisticId);
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
      };

      let watchdogTimer = setTimeout(runWatchdog, PENDING_WATCHDOG_MS);

      try {
        // The single send closure, used both for the immediate send and for
        // the buffered replay. Passing the optimistic id as the stanza id
        // means the server echoes it back with the same value, so the
        // reducer's dedupe matches and the bubble flips pending → delivered
        // in-place (rather than rendering a second copy).
        const replaySend = (c: any) =>
          c.sendTextMessageWithTranslateTagStanza(
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
            (langSource as any) || 'en',
            optimisticId
          );

        // Always buffer a copy BEFORE attempting the live send. The WebSocket
        // can still read `status: 'online'` for a beat after the network
        // actually drops (the WS error lands a moment later), so a stanza sent
        // "while online" can vanish into a dying socket and never get echoed.
        // Buffering every send means the onOnline reconnect flush replays
        // anything that wasn't confirmed within the window. The server echo
        // removes the entry (see newMessageMidlleware), so a healthy online
        // send never actually replays — only genuinely-lost ones do.
        enqueueOutboundSend({
          optimisticId,
          roomJID: activeRoomJID,
          enqueuedAt: Date.now(),
          send: replaySend,
        });

        // Only treat a client as usable if its underlying stream is actually
        // `online` — the instance survives a network drop with a stale
        // 'connecting'/'offline' status, and sending through it would just
        // lose the stanza.
        const effectiveClient: any = [
          client,
          getGlobalXmppClient(),
          store.getState()?.chatSettingStore?.client,
        ].find((c: any) => c && c.status === 'online');

        if (!effectiveClient) {
          // No live stream — kick a reconnect; the buffered copy above is
          // replayed by the onOnline flush once the stream is back.
          const anyClient: any =
            client ||
            getGlobalXmppClient() ||
            store.getState()?.chatSettingStore?.client;
          try {
            anyClient?.forceReconnect?.();
          } catch {}
          return;
        }

        replaySend(effectiveClient);
        try {
          effectiveClient.ensureStreamAlive?.();
        } catch {}
        await handleMessageSent({
          message,
          roomJID: activeRoomJID,
          user,
          messageType: 'text',
        });
      } catch (error) {
        clearTimeout(watchdogTimer);
        // Same reasoning as the watchdog: once the bubble shows failed,
        // only an explicit tap-to-retry should resend it.
        removeOutboundSend(optimisticId);
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
    [editAction, client, user, langSource, dispatch, handleMessageSent, handleMessageEdited, handleMessageFailed, reduxStore]
  );

  const sendMedia = useCallback(
    async (
      data: any,
      type: string,
      activeRoomJID: string,
      isReply: boolean = false,
      isChecked: boolean = false,
      mainMessage: string = '',
      existingId?: string,
      caption?: CaptionInput
    ): Promise<boolean> => {
      if (!canSendMediaToRoom(activeRoomJID)) {
        console.warn('media not sent: room is end-to-end encrypted');
        return false;
      }

      client?.onCriticalSend?.(activeRoomJID);

      // One send = one message, whatever the caller handed us: a single file,
      // the composer's array, or the saved list on a retry. Extra files past
      // the cap are dropped here as well as in the composer.
      const files: any[] = (Array.isArray(data) ? data : [data])
        .filter((file) => !!file && typeof file === 'object')
        .slice(0, mediaFileCap(config));
      if (files.length === 0) {return false;}
      const first = files[0];

      const isE2ee = shouldEncrypt(activeRoomJID);
      const sizeLimit = mediaSizeLimit(config, isE2ee ? MAX_SEAL_BYTES : undefined);
      const captionFields = normalizeCaptionInput(caption);
      const id = existingId || `send-media-message:${uuidv4()}`;

      // Everything a retry needs to replay this send, in selection order.
      const failedPayload = (): FailedMessagePayload => ({
        kind: 'media',
        id,
        roomJID: activeRoomJID,
        data: toFailedFile(first, type),
        type,
        isReply,
        isChecked,
        mainMessage,
        files: files.map((file) => toFailedFile(file, type)),
        ...(captionFields
          ? {
              caption: captionFields.caption,
              ...(captionFields.mentions ? { captionMentions: captionFields.mentions } : {}),
            }
          : {}),
      });

      // Defensive size guard on every send path (the composer blocks it at
      // pick time, but retries replay the saved payload straight here).
      const oversize = files.find(
        (file) => typeof file?.size === 'number' && file.size > sizeLimit
      );
      if (oversize) {
        console.warn('media exceeds the size cap - not uploading', {
          name: oversize?.name,
          size: oversize?.size,
        });
        const error = new Error(
          `File exceeds the ${Math.round(sizeLimit / (1024 * 1024))} MB upload limit`
        );
        if (existingId) {
          dispatch(markMessageFailed(failedPayload()));
        }
        handleMessageFailed({
          message: 'media',
          roomJID: activeRoomJID,
          error,
          messageType: 'media',
        });
        return false;
      }

      const optimisticTimestamp = Date.now();
      const optimisticDate = new Date(optimisticTimestamp).toISOString();
      const selfId =
        (user as any)?.xmppUsername || (user as any)?.walletAddress || '';
      const displayName =
        `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || selfId;
      const normalizedFileUri = normalizeFileUri(first?.uri);
      const fileSizeStr = first?.size != null ? String(first.size) : '';

      // One tile per file, in selection order. A tile's id is local until the
      // upload returns the server's `_id`; the tile's upload state is keyed on it.
      const tiles: IAttachment[] = files.map((file, index) => {
        const localUrl = localPreviewUrl(file?.uri);
        return {
          attachmentId: localAttachmentId(id, index),
          location: '',
          mimetype: file?.type || file?.mimeType || type,
          originalName: file?.name,
          fileName: file?.name,
          size: file?.size != null ? String(file.size) : undefined,
          duration: file?.duration != null ? String(file.duration) : undefined,
          ...(localUrl ? { localUrl } : {}),
          uploadStatus: 'uploading',
          uploadProgress: 0,
        };
      });

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
              isMediafile: 'true',
              fileName: first?.name,
              location: normalizedFileUri,
              locationPreview: normalizedFileUri,
              mimetype: type,
              originalName: first?.name,
              size: fileSizeStr,
              duration: first?.duration,
              waveForm: first?.waveForm,
              attachments: tiles,
              isReply: isReply ? 'true' : 'false',
              showInChannel: `${isChecked}`,
              mainMessage,
              ...(captionFields
                ? {
                    caption: captionFields.caption,
                    captionMentions: captionFields.mentions,
                  }
                : {}),
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

      // Silent-failure watchdog for media-send (bug #18). Re-armed on every
      // retry, so a retried send gets its own window. While files are still
      // going up it is not a failure: it waits one more window instead.
      const armWatchdog = (): ReturnType<typeof setTimeout> =>
        setTimeout(() => {
          if (running) {
            mediaWatchdog = armWatchdog();
            return;
          }
          const state = reduxStore.getState();
          const roomMsgs = state.rooms?.rooms?.[activeRoomJID]?.messages || [];
          const stillPending = roomMsgs.find(
            (m: any) => m.id === id && m.pending
          );
          const alreadyFailed = state.roomHeapSlice?.failedMessages?.[id];
          if (stillPending && !alreadyFailed) {
            console.warn(
              `Media-send watchdog fired - ${id} stuck pending > ${MEDIA_PENDING_WATCHDOG_MS}ms; marking failed`
            );
            // See the text-send watchdog above: drop the buffered replay so
            // a later onOnline flush can't silently resend behind the
            // "failed / tap to retry" bubble.
            removeOutboundSend(id);
            dispatch(markMessageFailed(failedPayload()));
            handleMessageFailed({
              message: 'media',
              roomJID: activeRoomJID,
              error: new Error('Media send timed out (no server echo)'),
              messageType: 'media',
            });
          }
        }, MEDIA_PENDING_WATCHDOG_MS);
      const uploaded: Array<IAttachment | undefined> = files.map(() => undefined);
      const rawResults: Array<any | undefined> = files.map(() => undefined);
      const sealedUploads: Array<SealedUpload | undefined> = files.map(() => undefined);
      let delivered = false;
      let running = false;
      const concurrency = isE2ee ? MEDIA_E2EE_UPLOAD_CONCURRENCY : MEDIA_UPLOAD_CONCURRENCY;
      let mediaWatchdog = armWatchdog();

      const publishTile = (
        index: number,
        patch: { uploadStatus?: 'uploading' | 'failed' | null; uploadProgress?: number }
      ) => {
        const attachmentId = tiles[index]?.attachmentId;
        if (config?.disableSentLogic || !attachmentId) {return;}
        dispatch(
          setMediaUploadState({
            roomJID: activeRoomJID,
            messageId: id,
            attachmentId,
            ...patch,
          })
        );
      };

      const missingIndices = () =>
        uploaded.reduce<number[]>(
          (acc, item, index) => (item ? acc : [...acc, index]),
          []
        );

      const uploadOne = async (index: number): Promise<void> => {
        const file = files[index];
        publishTile(index, { uploadStatus: 'uploading', uploadProgress: 0 });

        // Helps RN's FormData polyfill build a proper multipart/file part
        // (instead of serialising the JS object as JSON). On iOS the picker
        // can return ph:// or assets-library:// URIs; coerce to file:// when
        // possible so the body is a real blob.
        const fileBlob = {
          uri: normalizeFileUri(file?.uri) || file?.uri,
          type: file?.type || file?.mimeType || type || 'application/octet-stream',
          name: file?.name || file?.fileName || `media_${Date.now()}_${index}`,
        };

        // In an e2ee room each file is sealed before it leaves the device:
        // the server only ever sees opaque bytes under a random name. The
        // per-file keys ride in the encrypted <body> (see sendMediaMessage).
        if (isE2ee) {
          sealedUploads[index]?.dispose();
          sealedUploads[index] = undefined;
          const { sealPickedFile } =
            require('../e2ee/sealedFiles') as typeof import('../e2ee/sealedFiles');
          sealedUploads[index] = await sealPickedFile({
            uri: fileBlob.uri,
            name: fileBlob.name,
            type: fileBlob.type,
            size: typeof file?.size === 'number' ? file.size : undefined,
          });
        }
        const sealed = sealedUploads[index];
        const part = sealed
          ? { uri: sealed.uri, type: 'application/octet-stream', name: sealed.name }
          : fileBlob;
        const options = {
          clientEncrypted: !!sealed,
          onProgress: (percent: number) =>
            publishTile(index, { uploadProgress: percent }),
        };
        const post = (field: 'files' | 'file') => {
          const fd = new FormData();
          fd.append(field, part as any);
          return uploadFileV2(fd, activeRoomJID, options);
        };

        let response: { data: any };
        try {
          response = await post('files');
        } catch (err: any) {
          if (err?.response?.status !== 500) {throw err;}
          console.warn(
            'upload "files" field returned 500 - retrying with "file" (singular)',
            { name: part.name, type: part.type }
          );
          response = await post('file');
        }

        const raw = Array.isArray(response?.data?.results)
          ? response.data.results[0]
          : undefined;
        if (!raw) {throw new Error('media_upload_empty_response');}

        uploaded[index] = toUploadedAttachment(raw);
        rawResults[index] = raw;
        // The bytes are up; the message waits for its siblings.
        publishTile(index, { uploadStatus: 'uploading', uploadProgress: 100 });
      };

      const sendAssembled = async (): Promise<void> => {
        const raws = rawResults as any[];
        const attachments = uploaded as IAttachment[];
        const head = raws[0];

        const messagePayload = {
          firstName: user.firstName,
          lastName: user.lastName,
          walletAddress: user.walletAddress,
          createdAt: head.createdAt,
          expiresAt: head.expiresAt,
          fileName: head.filename,
          isVisible: head?.isVisible,
          location: head.location,
          locationPreview: head.locationPreview,
          mimetype: head.mimetype,
          originalName: head?.originalname,
          ownerKey: head?.ownerKey,
          size: head.size,
          duration: head?.duration ?? first?.duration,
          waveForm: first?.waveForm,
          updatedAt: head?.updatedAt,
          userId: head?.userId,
          attachmentId: head?._id,
          // Only when there is more than one file: sendMediaMessage stamps
          // the list on <data> and leaves a single-file stanza untouched.
          attachments: attachments.length > 1 ? attachments : undefined,
          caption: captionFields?.caption,
          captionMentions: captionFields?.mentions,
          wrappable: true,
          roomJid: activeRoomJID,
          showInChannel: isChecked,
          isReply,
          mainMessage,
          isPrivate: head?.isPrivate,
          __v: head.__v,
          // One key per sealed file, in selection order.
          e2eeKeys: isE2ee
            ? (sealedUploads.map((sealed) => sealed?.keyMaterial) as string[])
            : undefined,
        };

        // The local copies of sealed files are remembered for the sender and
        // the scratch ciphertext is dropped.
        if (isE2ee) {
          const { rememberOpened } =
            require('../e2ee/sealedFiles') as typeof import('../e2ee/sealedFiles');
          for (let index = 0; index < files.length; index++) {
            const item = attachments[index];
            try {
              await rememberOpened(item.location, {
                uri: normalizeFileUri(files[index]?.uri) || files[index]?.uri,
                name: files[index]?.name,
                type: files[index]?.type || files[index]?.mimeType || type,
                size: typeof files[index]?.size === 'number' ? files[index].size : undefined,
              });
            } catch (err) {
              console.warn('could not keep the sent attachment', err);
            }
            sealedUploads[index]?.dispose();
            sealedUploads[index] = undefined;
          }
        }

        // Replace the optimistic tiles with the uploaded files. A sealed
        // message keeps its local tiles (the server copies are ciphertext) and
        // only drops the upload state. `pending` is left alone: only the
        // server echo confirms the message.
        if (!config?.disableSentLogic) {
          dispatch(
            setMessageAttachments({
              roomJID: activeRoomJID,
              messageId: id,
              attachments: isE2ee
                ? tiles.map(withoutUploadState)
                : attachments.map((attachment, index) => {
                    const localUrl = tiles[index]?.localUrl;
                    return localUrl ? { ...attachment, localUrl } : attachment;
                  }),
            })
          );
        }

        const effectiveMediaClient: any = [
          client,
          getGlobalXmppClient(),
          store.getState()?.chatSettingStore?.client,
        ].find((c: any) => c && c.status === 'online');
        if (effectiveMediaClient) {
          effectiveMediaClient.setActiveRoomJid?.(activeRoomJID);
          await Promise.resolve(
            effectiveMediaClient.prioritizeRoomPresence?.(activeRoomJID)
          ).catch(() => false);
          effectiveMediaClient.sendMediaMessageStanza(activeRoomJID, messagePayload, id);
          try {
            effectiveMediaClient.ensureStreamAlive?.();
          } catch {}
        } else {
          // Same online-only guard as the text path: a surviving-but-offline
          // client must NOT be used. Buffer the stanza for the reconnect flush.
          const anyMediaClient: any =
            client ||
            getGlobalXmppClient() ||
            store.getState()?.chatSettingStore?.client;
          try {
            anyMediaClient?.forceReconnect?.();
          } catch {}
          enqueueOutboundSend({
            optimisticId: id,
            roomJID: activeRoomJID,
            enqueuedAt: Date.now(),
            // Match the media watchdog so a reconnect within the (longer)
            // media window still auto-replays the buffered stanza.
            ttlMs: MEDIA_PENDING_WATCHDOG_MS,
            send: (c) => c.sendMediaMessageStanza(activeRoomJID, messagePayload, id),
          });
        }

        delivered = true;
        unregisterMediaRetry(id);
        dispatch(clearMessageFailure(id));

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
            uploadResults: raws,
          },
        });
      };

      const failMessage = (error: unknown) => {
        console.error('Media send failed:', error);
        // Every file stays held: the bubble shows Failed, and Retry replays
        // the files that did not make it (in-session) or the whole list.
        dispatch(markMessageFailed(failedPayload()));
        handleMessageFailed({
          message: 'media',
          roomJID: activeRoomJID,
          error: error as Error,
          messageType: 'media',
        });
      };

      /**
       * Uploads `indices` (a retry passes only the files that failed), then
       * sends once nothing is missing. Any failure leaves the message failed
       * with its tiles marked, ready for a retry.
       */
      const run = async (indices: number[]): Promise<boolean> => {
        if (delivered || running) {return false;}
        running = true;
        clearTimeout(mediaWatchdog);
        mediaWatchdog = armWatchdog();
        try {
          await mapWithConcurrency(indices, concurrency, async (index) => {
            try {
              await uploadOne(index);
            } catch (error: any) {
              console.error('upload failed', {
                status: error?.response?.status,
                serverBody: error?.response?.data,
                axiosMessage: error?.message,
                fileName: files[index]?.name,
                fileSizeBytes: files[index]?.size ?? null,
                platformOS: Platform.OS,
              });
              publishTile(index, { uploadStatus: 'failed', uploadProgress: 0 });
            }
          });
          if (missingIndices().length > 0) {
            throw new Error('media_upload_failed');
          }
          await sendAssembled();
          return true;
        } catch (error) {
          failMessage(error);
          return false;
        } finally {
          running = false;
        }
      };

      registerMediaRetry(id, (indices?: number[]) =>
        run(
          missingIndices().filter(
            (position) => indices === undefined || indices.includes(position)
          )
        )
      );

      return run(files.map((_, index) => index));
    },
    [client, config, user, dispatch, handleMessageSent, handleMessageFailed, reduxStore]
  );

  // Retry a previously-failed send. An in-session send re-runs only the files
  // still missing (its runner is still registered); after a restart the
  // saved payload is replayed as a whole. No-op when the id isn't failed.
  const retryMessage = useCallback(
    async (failedId: string) => {
      const payload =
        reduxStore.getState().roomHeapSlice?.failedMessages?.[failedId];
      if (!payload) {return;}

      // The server may have accepted the original send even though its
      // echo arrived too late to beat the watchdog — the bubble shows
      // failed, but a confirmed (non-pending) copy is already sitting in
      // the room. Resending here would deliver a genuine duplicate; just
      // clear the failure and let the existing copy stand.
      const roomMsgs =
        reduxStore.getState().rooms?.rooms?.[payload.roomJID]?.messages || [];
      const alreadyDelivered = roomMsgs.some(
        (m: any) =>
          !m.pending && (m.id === failedId || m.xmppId === failedId)
      );
      if (alreadyDelivered) {
        dispatch(clearMessageFailure(failedId));
        return;
      }

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
          payload.mainMessage,
          // Re-use the failed message's id so the retry resends in place
          // instead of spawning a duplicate bubble.
          failedId
        );
        return;
      }
      if (hasMediaRetry(failedId)) {
        await retryMediaSend(failedId);
        return;
      }
      const list =
        Array.isArray(payload.files) && payload.files.length > 0
          ? payload.files
          : payload.data;
      await sendMedia(
        list,
        payload.type,
        payload.roomJID,
        payload.isReply,
        payload.isChecked,
        payload.mainMessage,
        failedId,
        payload.caption
          ? { text: payload.caption, mentions: payload.captionMentions }
          : undefined
      );
    },
    [reduxStore, dispatch, handleMessageRetry, sendMessage, sendMedia]
  );

  // ChatRoom/ThreadWrapper consume this as the "edit branch" of send.
  // It mirrors the edit path inside `sendMessage` so callers can wire it
  // up directly when `editAction.isEdit` is true.
  const sendEditMessage = useCallback(
    async (message: string, _activeRoomJID?: string) => {
      if (!editAction?.isEdit || !editAction.roomJid || !editAction.messageId) {
        return;
      }
      const edited = reduxStore
        .getState()
        .rooms?.rooms?.[editAction.roomJid]?.messages?.find(
          (m: IMessage) => m.id === editAction.messageId
        );
      if (edited && !canEditMessage(edited)) {
        console.warn('edit not sent: the message was encrypted');
        dispatch(setEditAction({ isEdit: false }));
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
      const msgs = reduxStore.getState().rooms?.rooms?.[roomJID]?.messages;
      if (!msgs || msgs.length === 0) {return false;}
      const last = msgs[msgs.length - 1];
      if (!last?.pending) {return false;}
      const selfId = user?.xmppUsername || user?.walletAddress;
      if (!selfId) {return false;}
      return last.user?.id === selfId;
    },
    [reduxStore, user?.xmppUsername, user?.walletAddress]
  );

  return {
    sendMessage,
    sendMedia,
    sendEditMessage,
    retryMessage,
    isLastMessageFromUserAndProcessing,
  };
};
