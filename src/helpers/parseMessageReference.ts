/** The parent a reply points at, read from its `mainMessage` JSON. */
export interface MessageReference {
  id: string;
  text: string;
  roomJid: string;
  userName?: string;
}

/** Loose view of a raw `mainMessage` JSON string (fields as sent). */
export interface ParsedMessageReference {
  id?: string;
  text?: string;
  roomJid?: string;
  userName?: string;
}

const cache = new WeakMap<object, MessageReference | null>();

/**
 * Safe read of a reply's parent reference. Null for a missing or malformed
 * value: a bad payload must not crash a bubble.
 *
 * Two call forms are supported:
 *  - `parseMessageReference(message)` reads `message.mainMessage`, returns a
 *    normalised MessageReference (id always a string) and is cached per
 *    message object;
 *  - `parseMessageReference(rawJsonString)` returns the parsed object as sent.
 */
export function parseMessageReference(
  input: { mainMessage?: string } | null | undefined
): MessageReference | null;
export function parseMessageReference(
  input: unknown
): ParsedMessageReference | null;
export function parseMessageReference(input: unknown): any {
  if (typeof input === 'string') {
    if (input.trim() === '') {return null;}
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  const message = input as { mainMessage?: string } | null | undefined;
  if (!message || typeof message !== 'object' || !message.mainMessage) {
    return null;
  }
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
}
