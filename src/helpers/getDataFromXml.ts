import { Element } from 'ltx';
import { Iso639_1Codes, IUser } from '../types/types';
import { transformArrayToObject } from './transformTranslatations';

// Tolerant JSON parse: a malformed `translations` attr must not reject the
// whole stanza (which would silently drop the message). Mirrors the web
// SDK's safeJsonParse.
const safeJsonParse = <T,>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value) {return fallback;}
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

// Keep only well-formed translation entries (drops partial/garbage items),
// same shape guard the web SDK applies before transformArrayToObject.
const normalizeTranslations = (value: unknown) =>
  Array.isArray(value)
    ? value.filter(
        (
          item
        ): item is {
          translatedText: string;
          language: string;
          languageName: string;
        } =>
          !!item &&
          typeof item === 'object' &&
          typeof (item as any).translatedText === 'string' &&
          typeof (item as any).language === 'string' &&
          typeof (item as any).languageName === 'string'
      )
    : [];

const extractTimestamp = (str: string, stanza?: any): string | null => {
  if (!str) {return null;}
  if (typeof str !== 'string') {
    console.log(str, stanza.toString());
    return null;
  }
  const timestamp = str.slice(-16);
  return timestamp;
};

interface DataXml {
  id: string;
  body?: string;
  roomJid: string;
  date: string;
  user: IUser;
  deleted?: boolean;
  translations?: any;
  langSource?: Iso639_1Codes;
  xmppId?: string;
  xmppFrom?: string;
  data: { [x: string]: any };
}
export const getDataFromXml = async (stanza: Element): Promise<DataXml | undefined> => {
  const fullData =
    stanza.getChild('result')?.getChild('forwarded')?.getChild('message') ||
    stanza;

  const xmppId = fullData?.attrs.id;
  const xmppFrom = fullData?.attrs?.from;
  const [roomJid, userWallet] = (xmppFrom || '').split('/');
  let id =
    stanza.getChild('result')?.attrs.id ||
    extractTimestamp(stanza?.getChild('stanza-id')?.attrs?.id, stanza);

  if (!id) {
    id = xmppId || Date.now().toString();
  }

  const body = fullData?.getChild('body')?.getText() || undefined;
  const deleted = !!fullData?.getChild('deleted');
  const translationPayload = safeJsonParse<{ translates?: unknown[] }>(
    fullData?.getChild('translations')?.attrs?.value,
    {}
  );
  const translations = fullData?.getChild('translations')?.attrs?.value
    ? transformArrayToObject(normalizeTranslations(translationPayload.translates))
    : undefined;
  const langSource = fullData?.getChild('translate')?.attrs?.source as
    | Iso639_1Codes
    | undefined;
  const numericPart = /\d{13,}/.exec(id || '')?.[0];
  const date = numericPart
    ? new Date(+numericPart.slice(0, 13)).toISOString()
    : new Date().toISOString();

  const data = fullData?.getChild('data') || stanza?.getChild('data');
  const photoURL = data?.attrs?.photo;

  const user = {
    id: userWallet,
    photoURL,
  } as any;

  const dataAttrs = data?.attrs || {};

  return {
    data: dataAttrs,
    id,
    body,
    roomJid,
    date,
    user,
    deleted,
    translations,
    langSource,
    xmppId,
    xmppFrom,
  };
};
