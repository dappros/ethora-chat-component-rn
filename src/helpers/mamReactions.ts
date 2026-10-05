import { IMessage } from '../types/models/message.model';
import { applyReactionToMessage, compareStanzaIds } from '../roomStore/roomsSlice';

export interface ExtractedReaction {
  messageId: string;
  from: string;
  emoji: string[];
  data: Record<string, string>;
  roomJID: string;
  /** Server stanza id (microsecond timestamp) — orders reactions. */
  ts?: string;
}

export const extractReaction = (
  msg: any,
  fallbackRoomJID?: string,
  archiveId?: string
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
  const rawTs = String(archiveId || stanzaId?.attrs?.id || '');
  const ts = /^\d+$/.test(rawTs) ? rawTs : undefined;
  return { messageId, from, emoji, data, roomJID, ...(ts ? { ts } : {}) };
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
  // Oldest first, so the newest state of each reactor wins.
  const ordered = reactions
    .slice()
    .sort((a, b) => (a.ts && b.ts ? compareStanzaIds(a.ts, b.ts) : 0));
  for (const reaction of ordered) {
    const target = byId.get(String(reaction.messageId));
    if (target) {
      applyReactionToMessage(target, reaction.from, reaction.emoji, reaction.data, reaction.ts);
    } else {
      deferred.push(reaction);
    }
  }
  return deferred;
};
