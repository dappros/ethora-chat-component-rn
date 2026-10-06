/** @format */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ThemePreference } from '../theme/theme';

const KEY = '@ethora/preferences';

/** Small, unencrypted, per-device user preferences set from Settings. */
export interface StoredPreferences {
  theme?: ThemePreference;
  pushEnabled?: boolean;
  /** Interface language picked in Settings (BCP-47). */
  uiLocale?: string;
  /** Language messages are translated into, picked in Settings (BCP-47). */
  chatLanguage?: string;
}

export const loadPreferences = async (): Promise<StoredPreferences> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredPreferences) : {};
  } catch {
    return {};
  }
};

export const savePreferences = async (
  patch: StoredPreferences
): Promise<void> => {
  try {
    const current = await loadPreferences();
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...current, ...patch }));
  } catch (error) {
    console.warn('[preferences] save failed', error);
  }
};

export const clearPreferences = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};
