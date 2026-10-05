import { EMOJI_CATEGORIES, type EmojiEntry } from '../assets/emojiData';

let byId: Map<string, EmojiEntry> | null = null;
const index = (): Map<string, EmojiEntry> => {
  if (!byId) {
    byId = new Map();
    for (const category of EMOJI_CATEGORIES) {
      for (const entry of category.emojis) {byId.set(entry[0], entry);}
    }
  }
  return byId;
};

export const getEmojiNativeById = (id: string): string =>
  index().get(id)?.[1] ?? id;

export const getEmojiIdByNative = (native: string): string | undefined => {
  for (const [id, entry] of index()) {
    if (entry[1] === native) {return id;}
  }
  return undefined;
};

export const DEFAULT_QUICK_REACTIONS = ['+1', 'heart', 'joy', 'open_mouth', 'cry', 'pray'];

export const searchEmojis = (query: string, limit = 60): EmojiEntry[] => {
  const q = query.trim().toLowerCase();
  if (!q) {return [];}
  const out: EmojiEntry[] = [];
  for (const category of EMOJI_CATEGORIES) {
    for (const entry of category.emojis) {
      if (entry[0].includes(q) || entry[2].includes(q)) {
        out.push(entry);
        if (out.length >= limit) {return out;}
      }
    }
  }
  return out;
};
