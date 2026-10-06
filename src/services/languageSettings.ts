// The user's two languages, as the backend keeps them on the profile:
//
//   appLanguage  - the interface: the chat's captions (`uiLocale`).
//   chatLanguage - what incoming messages are translated into, and the
//                  language declared on the user's own messages (`langSource`).
//
// Both are per account, not per device: a choice made here is written to the
// profile with `PUT /v1/users` - one field per request, as the web app does,
// so writing one never rewrites the other - and the profile's values are
// applied when a session starts. The last choice is also kept on the device,
// so the interface comes up in the right language before the profile loads.
//
// Translation itself happens on the server, per the reader's chatLanguage:
// that is why the choice has to reach the profile for a translation to ever
// arrive on a message.

import { store } from '../roomStore';
import { setLangSource, setUiLocale, updateUser } from '../roomStore/chatSettingsSlice';
import { savePreferences } from '../helpers/preferencesStorage';
import { updateMe } from '../networking/api-requests/user.api';
import { LANGUAGE_OPTIONS } from '../helpers/constants/LANGUAGE_OPTIONS';
import type { IConfig } from '../types/types';

export interface LanguageChoice {
  /** BCP-47 tag, e.g. "fr-CA". */
  id: string;
  /** The language's own name for itself. */
  name: string;
}

const AUTONYMS: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  pt: 'Português',
  ht: 'Kreyòl ayisyen',
  zh: '中文',
  de: 'Deutsch',
  it: 'Italiano',
  uk: 'Українська',
  ru: 'Русский',
  pl: 'Polski',
  tr: 'Türkçe',
  ar: 'العربية',
  hi: 'हिन्दी',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  sv: 'Svenska',
};

/** "en-ca" -> "en-CA"; anything that is not a language tag -> undefined. */
export const canonicalLocale = (value: unknown): string | undefined => {
  const raw = String(value ?? '').trim();
  const match = /^([A-Za-z]{2,3})(?:[-_]([A-Za-z0-9]{2,8}))?$/.exec(raw);
  if (!match) {return undefined;}
  const [, language, region] = match;
  const base = language!.toLowerCase();
  if (!region) {return base;}
  return `${base}-${region.length === 2 ? region.toUpperCase() : region}`;
};

export const languageLabel = (id: string): string => {
  const exact = LANGUAGE_OPTIONS.find((o) => o.id.toLowerCase() === id.toLowerCase());
  if (exact) {return exact.name;}
  return AUTONYMS[id.split('-')[0]!.toLowerCase()] || id;
};

const toChoices = (ids: string[] | undefined): LanguageChoice[] | undefined => {
  const list = (ids || []).map(canonicalLocale).filter((id): id is string => !!id);
  return list.length ? list.map((id) => ({ id, name: languageLabel(id) })) : undefined;
};

export const languagesEnabled = (config?: IConfig | null): boolean =>
  config?.settings?.languages?.enabled === true;

/** What the interface can be shown in. */
export const appLanguageChoices = (config?: IConfig | null): LanguageChoice[] =>
  toChoices(config?.settings?.languages?.appLanguages) ??
  LANGUAGE_OPTIONS.map((o) => ({ id: o.id, name: o.name }));

/** What messages can be translated into. */
export const chatLanguageChoices = (config?: IConfig | null): LanguageChoice[] =>
  toChoices(config?.settings?.languages?.chatLanguages) ??
  LANGUAGE_OPTIONS.map((o) => ({ id: o.id, name: o.name }));

async function writeToProfile(field: 'appLanguage' | 'chatLanguage', value: string) {
  try {
    await updateMe({ [field]: value });
    // The field alone: replacing the whole user with the backend's profile
    // would drop what only this side holds (tokens, the XMPP password).
    store.dispatch(updateUser({ updates: { [field]: value } }));
    return true;
  } catch (error) {
    // The local choice stands: a flaky network degrades to a device-only
    // setting rather than silently reverting what the user just picked.
    console.warn(`[languages] could not save ${field}`, error);
    return false;
  }
}

/** The interface language. Applied at once; written to the profile behind. */
export async function setAppLanguage(id: string): Promise<boolean> {
  const locale = canonicalLocale(id);
  if (!locale) {return false;}
  store.dispatch(setUiLocale(locale));
  void savePreferences({ uiLocale: locale });
  if (!languagesEnabled(store.getState().chatSettingStore.config)) {return true;}
  return writeToProfile('appLanguage', locale);
}

/** The language messages are translated into. */
export async function setChatLanguage(id: string): Promise<boolean> {
  const locale = canonicalLocale(id);
  if (!locale) {return false;}
  store.dispatch(setLangSource(locale as any));
  void savePreferences({ chatLanguage: locale });
  if (!languagesEnabled(store.getState().chatSettingStore.config)) {return true;}
  return writeToProfile('chatLanguage', locale);
}

/**
 * The profile's languages, applied when a session starts. The profile is the
 * account's truth; what the device remembered only bridged the gap until
 * now. A profile that has never chosen leaves the device's value alone.
 */
export function applyProfileLanguages(
  user: { appLanguage?: string | null; chatLanguage?: string | null } | null | undefined,
  config?: IConfig | null
): void {
  if (!user || !languagesEnabled(config)) {return;}
  const app = canonicalLocale(user.appLanguage);
  if (app && app !== store.getState().chatSettingStore.uiLocale) {
    store.dispatch(setUiLocale(app));
    void savePreferences({ uiLocale: app });
  }
  // Unset means "follow the app language" - the backend's own rule.
  const chat = canonicalLocale(user.chatLanguage) || app;
  if (chat && chat !== store.getState().chatSettingStore.langSource) {
    store.dispatch(setLangSource(chat as any));
    void savePreferences({ chatLanguage: chat });
  }
}
