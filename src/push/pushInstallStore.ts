import { Platform } from 'react-native';
import { randomBytes, toHex } from '../e2ee/crypto';
import { loadSecureStore, type SecureStoreOptions } from '../helpers/secureStoreRuntime';
import type { PushTokenType } from '../types/types';
import { pushLog } from '../utils/devLogger';

// What an install knows about its own push registrations, kept in the
// keychain / keystore through expo-secure-store:
//
//   - the install id (`deviceId` of a registration). A push token belongs to
//     the install, not to the user, and the OS may issue a new one at any
//     time. A backend that knows `deviceId` replaces the install's earlier
//     token with the one being registered, so one install holds one token.
//   - the tokens this install registered and has not seen removed, so a
//     token the OS replaced is deleted on the backend even when the app was
//     restarted (or reinstalled, on iOS) in between. This is what keeps a
//     backend without `deviceId` from collecting dead tokens.
//
// Both must stay on the device that wrote them. An id restored onto a second
// phone would make the two replace each other's token; a remembered token
// restored there would get the first phone's registration deleted. So the
// items are written `ThisDeviceOnly` on iOS; on Android expo-secure-store
// ties every value to a keystore key that never leaves the device and has no
// such setting. Nothing here falls back to AsyncStorage, which travels with
// backups: without expo-secure-store (or, on iOS, with a version that lacks
// the constant) there is no install id and no memory, and registration works
// as it did before.
//
// The item names are a contract with hosts that register tokens themselves
// (the Ethora app reads the same id).

export const PUSH_INSTALL_KEYCHAIN_SERVICE = 'ethora.push.install';
export const PUSH_DEVICE_ID_ITEM = 'ethora_push_device_id';
export const PUSH_REGISTRATIONS_ITEM = 'ethora_push_registrations';

/** A token this install registered on a backend and has not seen removed. */
export interface RememberedPushRegistration {
  token: string;
  tokenType: PushTokenType;
  appId: string;
  xmppUsername: string;
  /** API base URL the token was registered on. */
  server: string;
}

const DEVICE_ID = /^[0-9a-f]{32}$/;
// A phone has two live tokens at most (chat, VoIP); the rest of the room is
// for tokens of other accounts that could not be released yet.
const MAX_REMEMBERED = 8;

const storeOptions = (): SecureStoreOptions | null => {
  const store = loadSecureStore();
  if (!store) {return null;}
  if (Platform.OS === 'android') {
    return { keychainService: PUSH_INSTALL_KEYCHAIN_SERVICE };
  }
  const accessible = store.accessible.afterFirstUnlockThisDeviceOnly;
  if (Platform.OS !== 'ios' || accessible === undefined) {return null;}
  return {
    keychainService: PUSH_INSTALL_KEYCHAIN_SERVICE,
    keychainAccessible: accessible,
  };
};

export const isPushInstallStoreAvailable = (): boolean => storeOptions() !== null;

let deviceId: string | null = null;
let deviceIdInFlight: Promise<string | null> | null = null;

const readOrCreateDeviceId = async (): Promise<string | null> => {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {return null;}

  let stored: string | null;
  try {
    stored = await store.getItemAsync(PUSH_DEVICE_ID_ITEM, options);
  } catch (e) {
    // The keychain is there but did not answer (locked before the first
    // unlock): the id may well exist, so do not write a new one over it.
    pushLog('warn', 'push: reading the install id failed', e);
    return null;
  }
  if (stored && DEVICE_ID.test(stored)) {return stored;}

  const created = toHex(randomBytes(16));
  try {
    await store.setItemAsync(PUSH_DEVICE_ID_ITEM, created, options);
    // Only an id that is really kept is worth sending: one that changed on
    // every launch would never match the row it is meant to replace.
    const check = await store.getItemAsync(PUSH_DEVICE_ID_ITEM, options);
    if (check !== created) {
      pushLog('warn', 'push: the install id was not kept');
      return null;
    }
  } catch (e) {
    pushLog('warn', 'push: storing the install id failed', e);
    return null;
  }
  return created;
};

/**
 * The id of this install for push registrations (32 hex characters), created
 * on first call. Null when it cannot be kept on this device only, i.e.
 * without expo-secure-store; registrations then go without it.
 */
export function getPushDeviceId(): Promise<string | null> {
  if (deviceId) {return Promise.resolve(deviceId);}
  if (!deviceIdInFlight) {
    deviceIdInFlight = readOrCreateDeviceId()
      .then((id) => {
        deviceId = id;
        return id;
      })
      .catch(() => null)
      .finally(() => {
        deviceIdInFlight = null;
      });
  }
  return deviceIdInFlight;
}

const isRemembered = (entry: any): entry is RememberedPushRegistration =>
  !!entry &&
  typeof entry.token === 'string' &&
  !!entry.token &&
  typeof entry.tokenType === 'string' &&
  typeof entry.appId === 'string' &&
  typeof entry.xmppUsername === 'string' &&
  typeof entry.server === 'string';

/**
 * The remembered registrations, oldest first. Null when they cannot be read
 * right now (no secure store, or the keychain did not answer): the caller
 * must then leave them alone instead of writing an empty list over them.
 */
export async function loadRememberedPushRegistrations(): Promise<
  RememberedPushRegistration[] | null
> {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {return null;}
  let raw: string | null;
  try {
    raw = await store.getItemAsync(PUSH_REGISTRATIONS_ITEM, options);
  } catch (e) {
    pushLog('warn', 'push: reading the remembered registrations failed', e);
    return null;
  }
  if (!raw) {return [];}
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isRemembered) : [];
  } catch {
    return [];
  }
}

export async function saveRememberedPushRegistrations(
  list: RememberedPushRegistration[]
): Promise<void> {
  const store = loadSecureStore();
  const options = storeOptions();
  if (!store || !options) {return;}
  try {
    if (!list.length) {
      await store.deleteItemAsync(PUSH_REGISTRATIONS_ITEM, options);
      return;
    }
    await store.setItemAsync(
      PUSH_REGISTRATIONS_ITEM,
      JSON.stringify(list.slice(-MAX_REMEMBERED)),
      options
    );
  } catch (e) {
    pushLog('warn', 'push: storing the remembered registrations failed', e);
  }
}

/** Test seam only. */
export const __resetPushInstallStoreForTests = (): void => {
  deviceId = null;
  deviceIdInFlight = null;
};
