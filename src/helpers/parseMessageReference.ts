/** The parent a reply points at, read from its `mainMessage` JSON. */
export interface MessageReference {
  id: string;
  text: string;
  roomJid: string;
  userName?: string;
}

const cache = new WeakMap<object, MessageReference | null>();

/**
 * Safe read of `message.mainMessage` (a JSON string on the wire). Null for
 * a missing or malformed value — a bad payload must not crash a bubble.
 * Cached per message object.
 */
export const parseMessageReference = (message: {
  mainMessage?: string;
} | null | undefined): MessageReference | null => {
  if (!message?.mainMessage) {return null;}
  const cached = cache.get(message);
  if (cached !== undefined) {return cached;}
  let ref: MessageReference | null = null;
  try {
    const parsed = JSON.parse(message.mainMessage);
    if (parsed && parsed.id != null) {
      ref = {
        id: String(parsed.id),
        text: typeof parsed.text === 'string' ? parsed.text : '',
        roomJid: typeof parsed.roomJid === 'string' ? parsed.roomJid : '',
        userName: typeof parsed.userName === 'string' ? parsed.userName : undefined,
      };
    }
  } catch {
    ref = null;
  }
  cache.set(message, ref);
  return ref;
};
