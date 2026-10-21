import { Alert, Linking } from 'react-native';
import { store } from '../roomStore';
import { toastEmitter } from '../utils/toastEmitter';
import {
  cancelScheduledCall,
  getScheduledCall,
  type ScheduledCallDetail,
} from '../networking/api-requests/scheduledCalls.api';
import { translateCallString } from '../components/VideoCalls/callActions';
import { startRoomCall, type StartRoomCallOutcome } from './startRoomCall';

/**
 * What the buttons of the invite card and the pre-join sheet do. Kept out of
 * the components so both share one behaviour (and so it reads in one place).
 */

const t = translateCallString;

const toast = (type: 'success' | 'error', message: string) =>
  toastEmitter.emit({
    id: `scheduled-call-${Date.now()}`,
    title: t(type === 'success' ? 'toast.successTitle' : 'toast.error'),
    message,
    type,
  });

export const notifyScheduledCall = toast;

/** A link the backend gave us, opened as is. Only web links are opened. */
export const openBackendLink = async (url: string | undefined): Promise<void> => {
  if (!url || !/^https?:\/\//i.test(url)) {
    toast('error', t('booking.error.openLink'));
    return;
  }
  try {
    await Linking.openURL(url);
  } catch {
    toast('error', t('booking.error.openLink'));
  }
};

const JOIN_ERRORS: Partial<Record<StartRoomCallOutcome, string>> = {
  busy: 'booking.error.busy',
  disabled: 'booking.error.callsOff',
  'no-room': 'booking.error.joinFailed',
  failed: 'booking.error.joinFailed',
};

/** The user tapped Join: the room's ordinary call start / join. */
export const joinScheduledCall = async (
  roomJidOrName: string,
  kind: 'audio' | 'video'
): Promise<boolean> => {
  const outcome = await startRoomCall(roomJidOrName, kind);
  const errorKey = JOIN_ERRORS[outcome];
  if (errorKey) {
    toast('error', t(errorKey));
    return false;
  }
  return true;
};

const confirmCancel = (): Promise<boolean> =>
  new Promise((resolve) => {
    Alert.alert(
      t('booking.confirm.cancelTitle'),
      t('booking.confirm.cancelMessage'),
      [
        {
          text: t('booking.action.keepCall'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: t('booking.action.cancelCall'),
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });

/** Ask, then cancel. Resolves true when the call was cancelled. */
export const confirmAndCancelScheduledCall = async (
  slug: string
): Promise<boolean> => {
  if (!(await confirmCancel())) {return false;}
  try {
    await cancelScheduledCall(slug);
    invalidateScheduledCallDetail(slug);
    toast('success', t('booking.toast.cancelled'));
    return true;
  } catch {
    toast('error', t('booking.error.cancel'));
    return false;
  }
};

// ---- detail cache: the cards ask for a call's detail (creator, notes) once.

const details = new Map<string, Promise<ScheduledCallDetail>>();

export const getScheduledCallDetailCached = (
  slug: string,
  version: string
): Promise<ScheduledCallDetail> => {
  const key = `${slug}|${version}`;
  let hit = details.get(key);
  if (!hit) {
    hit = getScheduledCall(slug);
    details.set(key, hit);
    hit.catch(() => details.delete(key));
  }
  return hit;
};

export const invalidateScheduledCallDetail = (slug: string): void => {
  [...details.keys()]
    .filter((key) => key.startsWith(`${slug}|`))
    .forEach((key) => details.delete(key));
};

export const __resetScheduledCallDetailCacheForTests = (): void => details.clear();

/**
 * May this user edit or cancel the call? The server decides for real
 * (creator or room owner); this only decides whether to show the buttons.
 */
export const canManageScheduledCall = (params: {
  createdBy?: string;
  userId?: string;
  roomRole?: string;
}): boolean => {
  const { createdBy, userId, roomRole } = params;
  if (createdBy && userId && createdBy === userId) {return true;}
  return roomRole === 'owner' || roomRole === 'moderator';
};

export const currentUserId = (): string =>
  store.getState().chatSettingStore.user?._id || '';
