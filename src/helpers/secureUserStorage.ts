import { User } from '../types/types';
import { asyncLocalStorage } from '../hooks/useLocalStorage';
import { localStorageConstants } from './constants/LOCAL_STORAGE';
import { secureGet, secureSet, secureRemove } from './secureKeyValue';

// Keychain (iOS) / Keystore-backed EncryptedSharedPreferences (Android)
// keys for the four live bearer credentials on `User`. Deliberately one
// key per field rather than one JSON blob: expo-secure-store historically
// caps a single value's size on Android, and four short JWTs each stay
// comfortably under that ceiling where one combined blob might not.
const SECRET_KEYS = {
  token: 'ethora_auth_token',
  refreshToken: 'ethora_auth_refresh_token',
  xmppPassword: 'ethora_auth_xmpp_password',
  fileToken: 'ethora_auth_file_token',
} as const;

type SecretField = keyof typeof SECRET_KEYS;
const SECRET_FIELDS = Object.keys(SECRET_KEYS) as SecretField[];

/**
 * Persisted-user storage, split across two backends behind the exact
 * same `{ get, set, remove }` shape `asyncLocalStorage<User>(...)`
 * already exposed — every existing call site swaps in by changing only
 * the constructor call, `get()`/`set()`/`remove()` keep returning/taking
 * a complete `User`.
 *
 * The four live credentials (REST access + refresh token, XMPP
 * password, secure-media fileToken) never touch plain AsyncStorage:
 * they go through `secureGet`/`secureSet`/`secureRemove` (platform
 * Keychain/Keystore, falling back to namespaced AsyncStorage only when
 * the host hasn't installed the optional `expo-secure-store` peer dep).
 * Everything else on `User` — name, avatar, ids, xmppUsername, wallet
 * address, none of it a bearer credential — keeps living under the
 * existing `ETHORA_USER` AsyncStorage key, unchanged.
 */
export function secureUserStorage() {
  const get = async (): Promise<User | null> => {
    const profile = await asyncLocalStorage<User>(
      localStorageConstants.ETHORA_USER
    ).get();
    if (!profile) {return null;}

    const secretValues = await Promise.all(
      SECRET_FIELDS.map((field) => secureGet(SECRET_KEYS[field]))
    );

    const merged: User = { ...profile };
    SECRET_FIELDS.forEach((field, i) => {
      (merged as any)[field] = secretValues[i] || '';
    });
    return merged;
  };

  const set = async (user: User): Promise<void> => {
    const profile: any = { ...user };
    for (const field of SECRET_FIELDS) {
      profile[field] = '';
    }

    await Promise.all([
      asyncLocalStorage<User>(localStorageConstants.ETHORA_USER).set(profile),
      ...SECRET_FIELDS.map((field) => {
        const value = user?.[field] as string | undefined;
        return value
          ? secureSet(SECRET_KEYS[field], value)
          : secureRemove(SECRET_KEYS[field]);
      }),
    ]);
  };

  const remove = async (): Promise<void> => {
    await Promise.all([
      asyncLocalStorage(localStorageConstants.ETHORA_USER).remove(),
      ...SECRET_FIELDS.map((field) => secureRemove(SECRET_KEYS[field])),
    ]);
  };

  return { get, set, remove };
}
