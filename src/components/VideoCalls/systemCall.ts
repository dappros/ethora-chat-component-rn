import { Platform } from 'react-native';


export interface CallKeepModule {
  setup: (options: any) => Promise<void>;
  displayIncomingCall: (
    uuid: string,
    handle: string,
    localizedCallerName?: string,
    handleType?: string,
    hasVideo?: boolean
  ) => void;
  endCall: (uuid: string) => void;
  endAllCalls: () => void;
  startCall?: (
    uuid: string,
    handle: string,
    contactIdentifier?: string,
    handleType?: string,
    hasVideo?: boolean
  ) => void;
  answerIncomingCall?: (uuid: string) => void;
  reportConnectingOutgoingCallWithUUID?: (uuid: string) => void;
  reportConnectedOutgoingCallWithUUID?: (uuid: string) => void;
  reportEndCallWithUUID?: (uuid: string, reason: number) => void;
  setMutedCall?: (uuid: string, muted: boolean) => void;
  addEventListener: (event: string, handler: (payload: any) => void) => void;
  removeEventListener: (event: string) => void;
  setAvailable?: (available: boolean) => void;
  backToForeground?: () => void;
  clearInitialEvents?: () => void;
}

let cachedCallKeep: CallKeepModule | null | undefined;

export const loadCallKeep = (): CallKeepModule | null => {
  if (cachedCallKeep !== undefined) {
    return cachedCallKeep;
  }
  try {
    const { NativeModules } = require('react-native');
    if (!NativeModules?.RNCallKeep) {
      cachedCallKeep = null;
      return cachedCallKeep;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-callkeep');
    cachedCallKeep = (mod?.default || mod) as CallKeepModule;
  } catch {
    cachedCallKeep = null;
  }
  return cachedCallKeep;
};

export const callKitUuid = (seed: string): string => {
  let hash = 0x811c9dc5;
  const bytes: number[] = [];
  for (let i = 0; i < 32; i++) {
    const ch = seed.charCodeAt(i % Math.max(1, seed.length)) + i;
    hash ^= ch;
    hash = Math.imul(hash, 0x01000193) >>> 0;
    bytes.push(hash & 0xff);
  }
  const hex = bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
};

export type SystemCallAction = 'answer' | 'end';

const SYSTEM_ACTION_TTL_MS = 2 * 60 * 1000;
const pendingActions = new Map<string, { action: SystemCallAction; at: number }>();

const key = (uuid: string) => uuid.trim().toLowerCase();

export const rememberSystemCallAction = (
  uuid: string,
  action: SystemCallAction
): void => {
  if (!uuid) {return;}
  pendingActions.set(key(uuid), { action, at: Date.now() });
};

export const takeSystemCallAction = (uuid: string): SystemCallAction | null => {
  const entry = pendingActions.get(key(uuid));
  pendingActions.delete(key(uuid));
  if (!entry || Date.now() - entry.at > SYSTEM_ACTION_TTL_MS) {return null;}
  return entry.action;
};

export const endSystemIncomingCall = (callId: string | null | undefined): void => {
  if (Platform.OS !== 'ios' || !callId) {return;}
  const callKeep = loadCallKeep();
  if (!callKeep?.reportEndCallWithUUID) {return;}
  try {
    callKeep.reportEndCallWithUUID(callKitUuid(callId), 3);
  } catch {
  }
};

export const __resetSystemCallForTests = (): void => {
  pendingActions.clear();
  cachedCallKeep = undefined;
};
