import { IMessage } from '../types/models/message.model';
import { applyReactionToMessage } from '../roomStore/roomsSlice';

export interface ExtractedReaction {
  messageId: string;
  from: string;
  emoji: string[];
  data: Record<string, string>;
  roomJID: string;
}

export const extractReaction = (
  msg: any,
  fallbackRoomJID?: string
): ExtractedReaction | null => {
  const reactionsEl = msg?.getChild?.('reactions');
  if (!reactionsEl) {return null;}
  const messageId = reactionsEl.attrs?.id;
  const from = String(reactionsEl.attrs?.from || '');
  if (!messageId || !from.split('@')[0]) {return null;}
  const emoji: string[] = (reactionsEl.getChildren?.('reaction') || [])
    .map((reaction: any) => (reaction.text ? reaction.text() : ''))
    .filter(Boolean);
  const data = (msg.getChild?.('data')?.attrs || {}) as Record<string, string>;
  const stanzaId = msg.getChild?.('stanza-id');
  const roomJID = String(
    stanzaId?.attrs?.by || fallbackRoomJID || msg.attrs?.from || ''
  ).split('/')[0];
  return { messageId, from, emoji, data, roomJID };
};

export const applyMamReactions = (
  messages: IMessage[],
  reactions: ExtractedReaction[]
): ExtractedReaction[] => {
  const byId = new Map<string, IMessage>();
  for (const message of messages) {
    if (message?.id) {byId.set(String(message.id), message);}
  }
  const deferred: ExtractedReaction[] = [];
  for (const reaction of reactions) {
    const target = byId.get(String(reaction.messageId));
    if (target) {
      applyReactionToMessage(target, reaction.from, reaction.emoji, reaction.data);
    } else {
      deferred.push(reaction);
    }
  }
  return deferred;
};
