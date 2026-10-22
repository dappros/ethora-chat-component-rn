import type { IMessage, ModalFile } from '../types/types';
import { getAttachmentName, getMessageAttachments } from './attachments';
import { getFileKind } from './fileKind';
import { appendFileToken } from './secureFileUrl';
import { parseMessageReference } from './parseMessageReference';
import { composeName } from './displayName';
import { isOwnMessage } from './isOwnMessage';

export interface MediaOptions {
  /** The signed-in user, as isOwnMessage takes it. */
  me: Parameters<typeof isOwnMessage>[1];
  fileToken?: string;
  interactive: boolean;
  repliesOn: boolean;
}

/**
 * Every picture and video of the room's loaded history, newest first, each
 * carrying the message it came from so the viewer's Reply and Delete act on
 * the right one (same rules as a bubble: Delete on one's own, Reply where
 * replies are on).
 */
export const collectRoomMedia = (
  messages: IMessage[] | undefined,
  roomJid: string,
  { me, fileToken, interactive, repliesOn }: MediaOptions
): ModalFile[] => {
  const files: ModalFile[] = [];
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const message = messages![i]!;
    if (
      message.isMediafile !== 'true' ||
      message.isDeleted ||
      message.pending ||
      message.clientEncrypted === 'true' ||
      !message.id
    ) {
      continue;
    }
    const parent = parseMessageReference(message);
    const sentAt = new Date(message.date as any).getTime();
    const source = {
      messageId: message.id,
      roomJid: message.roomJid || roomJid,
      own: interactive && isOwnMessage(message, me),
      replyTo:
        interactive && repliesOn
          ? parent
            ? { id: parent.id, chatJID: parent.roomJid || message.roomJid || roomJid }
            : { id: message.id, chatJID: message.roomJid || roomJid }
          : undefined,
      senderName:
        composeName(message.user?.firstName, message.user?.lastName) ||
        message.user?.name ||
        undefined,
      timestamp: Number.isFinite(sentAt) ? sentAt : undefined,
    };
    for (const attachment of getMessageAttachments(message)) {
      if (!attachment.location) {continue;}
      const kind = getFileKind({
        mimetype: attachment.mimetype,
        name: getAttachmentName(attachment),
        url: attachment.location,
        duration: attachment.duration,
      });
      if (kind !== 'image' && kind !== 'video') {continue;}
      files.push({
        fileName: getAttachmentName(attachment),
        originalName: attachment.originalName,
        fileURL: appendFileToken(attachment.location, fileToken) || attachment.location,
        mimetype: attachment.mimetype || (kind === 'image' ? 'image/jpeg' : 'video/mp4'),
        duration: attachment.duration,
        previewURL: appendFileToken(attachment.locationPreview, fileToken),
        source,
      });
    }
  }
  return files;
};

const sentAt = (message: IMessage) => new Date(message.date as any).getTime() || 0;

/** A thread-only reply: shown in its thread, not in the channel. */
const threadParentOf = (message: IMessage): string | null =>
  message.mainMessage && message.showInChannel !== 'true'
    ? parseMessageReference(message)?.id ?? null
    : null;

/** The file's address without its access token, which may differ per copy. */
const bareUrl = (url: string | undefined) => (url || '').split('?')[0];

/**
 * The media feed the viewer pages through when a picture or video is opened
 * from a bubble: every picture and video of the list that bubble sits in (the
 * channel, or the one thread for a thread-only reply), oldest first so a
 * swipe to the left goes forward in time, the way the chat reads. The opened
 * file comes back with that feed as its siblings; null when the file is not
 * in the loaded history (the caller then keeps what it was opened with).
 */
export const withChatSiblings = (
  file: ModalFile,
  messages: IMessage[] | undefined,
  options: MediaOptions
): ModalFile | null => {
  const source = file.source;
  if (!source || !messages?.length) {return null;}
  const opened = messages.find((m) => String(m.id) === String(source.messageId));
  if (!opened) {return null;}

  const thread = threadParentOf(opened);
  // collectRoomMedia walks from the end, so newest-first in gives oldest
  // first out, with an album's files still in their own order.
  const scoped = messages
    .filter((m) => threadParentOf(m) === thread)
    .sort((a, b) => sentAt(b) - sentAt(a));
  const feed = collectRoomMedia(scoped, source.roomJid, options);

  const url = bareUrl(file.fileURL);
  const index = feed.findIndex(
    (f) =>
      f.source?.messageId === source.messageId && bareUrl(f.fileURL) === url
  );
  if (index < 0) {return null;}
  // The bubble's own rules for Reply and Delete stay with the opened file.
  return { ...feed[index]!, source, siblings: feed, index };
};
