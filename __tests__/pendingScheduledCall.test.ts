/**
 * A scheduled-call link that arrives before sign-in or before <Chat> is
 * ready is held, and opened once both are true. The queue is tested with
 * injected readiness; the store-bound wiring (readiness, push, URL entry
 * points) below it.
 */

const mockGetScheduledCall = jest.fn();
jest.mock('../src/networking/api-requests/scheduledCalls.api', () => ({
  __esModule: true,
  getScheduledCall: (...args: unknown[]) => mockGetScheduledCall(...args),
  isScheduledCallApiError: (e: any) => e?.name === 'ScheduledCallApiError',
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  PENDING_SCHEDULED_CALL_KEY,
  PENDING_SCHEDULED_CALL_TTL_MS,
  __resetPendingScheduledCallForTests,
  asyncPendingStorage,
  createPendingScheduledCallQueue,
  handleScheduledCallPush,
  handleScheduledCallUrl,
  isScheduledCallReady,
  isScheduledCallReminderPush,
  openScheduledCall,
  scheduledCallSlugFromPush,
  type PendingStorage,
} from '../src/booking/pendingScheduledCall';
import { handlePushPayload } from '../src/helpers/pushPayload';
import { scheduledCallUi } from '../src/booking/scheduledCallStore';
import { store } from '../src/roomStore';
import {
  setConfig,
  setConnectionState,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import { addRoom } from '../src/roomStore/roomsSlice';

const SLUG = 'Zq8x_LmN3pRtV-w2YkA9bc';
const flush = async () => {
  for (let i = 0; i < 10; i++) {await Promise.resolve();}
};

const memoryStorage = (): PendingStorage & { saved: any } => {
  const box: { saved: any } = { saved: null };
  return Object.assign(box, {
    read: async () => box.saved,
    write: async (v: any) => {
      box.saved = v;
    },
    clear: async () => {
      box.saved = null;
    },
  });
};

describe('pending queue', () => {
  const build = (ready: { value: boolean }, now = { value: 1000 }) => {
    const open = jest.fn();
    const storage = memoryStorage();
    const queue = createPendingScheduledCallQueue({
      isReady: () => ready.value,
      open,
      storage,
      now: () => now.value,
    });
    return { queue, open, storage, now };
  };

  it('opens at once when ready', () => {
    const { queue, open } = build({ value: true });
    expect(queue.submit(SLUG)).toBe('opened');
    expect(open).toHaveBeenCalledWith(SLUG);
    expect(queue.peek()).toBeNull();
  });

  it('holds the link while not ready and opens it once, when ready', async () => {
    const ready = { value: false };
    const { queue, open, storage } = build(ready);
    expect(queue.submit(SLUG)).toBe('held');
    await flush();
    expect(open).not.toHaveBeenCalled();
    expect(storage.saved).toEqual({ slug: SLUG, at: 1000 });

    expect(queue.poke()).toBe(false);
    ready.value = true;
    expect(queue.poke()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(SLUG);
    // Opened links are gone: another poke does nothing.
    expect(queue.poke()).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    await flush();
    expect(storage.saved).toBeNull();
  });

  it('a newer link replaces an older held one', () => {
    const ready = { value: false };
    const { queue, open } = build(ready);
    queue.submit('A'.repeat(22));
    queue.submit('B'.repeat(22));
    ready.value = true;
    queue.poke();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('B'.repeat(22));
  });

  it('drops a link older than the ttl', async () => {
    const ready = { value: false };
    const { queue, open, now } = build(ready);
    queue.submit(SLUG);
    now.value += PENDING_SCHEDULED_CALL_TTL_MS + 1;
    ready.value = true;
    expect(queue.poke()).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(queue.peek()).toBeNull();
  });

  it('restores a link persisted by an earlier run and opens it when ready', async () => {
    const ready = { value: false };
    const { queue, open, storage } = build(ready);
    storage.saved = { slug: SLUG, at: 900 };
    await queue.restore();
    expect(queue.peek()?.slug).toBe(SLUG);
    ready.value = true;
    queue.poke();
    expect(open).toHaveBeenCalledWith(SLUG);
  });

  it('ignores a stale persisted link', async () => {
    const { queue, open, storage, now } = build({ value: true });
    storage.saved = { slug: SLUG, at: 1000 };
    now.value = 1000 + PENDING_SCHEDULED_CALL_TTL_MS + 5;
    await queue.restore();
    expect(open).not.toHaveBeenCalled();
    await flush();
    expect(storage.saved).toBeNull();
  });

  it('a link that arrived while restoring wins over the persisted one', async () => {
    const ready = { value: false };
    const { queue, open, storage } = build(ready);
    storage.saved = { slug: 'OLD'.repeat(8), at: 900 };
    queue.submit(SLUG);
    await queue.restore();
    ready.value = true;
    queue.poke();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(SLUG);
  });
});

describe('asyncPendingStorage', () => {
  beforeEach(() => AsyncStorage.clear());

  it('round-trips and clears', async () => {
    await asyncPendingStorage.write({ slug: SLUG, at: 5 });
    expect(JSON.parse((await AsyncStorage.getItem(PENDING_SCHEDULED_CALL_KEY))!)).toEqual({
      slug: SLUG,
      at: 5,
    });
    expect(await asyncPendingStorage.read()).toEqual({ slug: SLUG, at: 5 });
    await asyncPendingStorage.clear();
    expect(await asyncPendingStorage.read()).toBeNull();
  });

  it('treats corrupt data as nothing', async () => {
    await AsyncStorage.setItem(PENDING_SCHEDULED_CALL_KEY, '{nope');
    expect(await asyncPendingStorage.read()).toBeNull();
  });
});

describe('store wiring', () => {
  const detail = (over: any = {}) => ({
    scheduledCall: {
      slug: SLUG,
      chatName: 'app_room1',
      title: 'Sync',
      startAt: new Date(Date.now() + 3600_000).toISOString(),
      durationMinutes: 30,
      kind: 'video',
      status: 'scheduled',
      ...over,
    },
    links: { join: `https://app.chat.ethora.com/call/${SLUG}` },
    chat: { name: 'app_room1', jid: 'app_room1@conference.xmpp.test', type: 'group' },
  });

  const signOut = () => {
    store.dispatch(setUser({ token: '' } as any));
    store.dispatch(setConnectionState('offline'));
  };
  const signIn = () => {
    store.dispatch(setUser({ token: 'tok', _id: 'u1' } as any));
  };

  beforeEach(async () => {
    __resetPendingScheduledCallForTests();
    scheduledCallUi.reset();
    mockGetScheduledCall.mockReset();
    await AsyncStorage.clear();
    store.dispatch(
      setConfig({
        baseUrl: 'https://api.test',
        xmppSettings: { conference: 'conference.xmpp.test' },
      } as any)
    );
    signOut();
  });

  it('is ready only when signed in, configured and connected', () => {
    expect(isScheduledCallReady()).toBe(false);
    signIn();
    expect(isScheduledCallReady()).toBe(false);
    store.dispatch(setConnectionState('connecting'));
    expect(isScheduledCallReady()).toBe(false);
    store.dispatch(setConnectionState('online'));
    expect(isScheduledCallReady()).toBe(true);
  });

  it('holds a link before sign-in and opens the room + pre-join after', async () => {
    mockGetScheduledCall.mockResolvedValue(detail());
    expect(openScheduledCall(SLUG)).toBe('pending');
    await flush();
    expect(mockGetScheduledCall).not.toHaveBeenCalled();
    expect(scheduledCallUi.getState().preJoin).toBeNull();

    signIn();
    store.dispatch(setConnectionState('online'));
    await flush();

    expect(mockGetScheduledCall).toHaveBeenCalledWith(SLUG);
    const preJoin = scheduledCallUi.getState().preJoin;
    expect(preJoin?.phase).toBe('ready');
    // The room was not loaded yet, so it is parked for the room list.
    expect(store.getState().rooms.pendingNotificationJid).toBe(
      'app_room1@conference.xmpp.test'
    );
  });

  it('opens the room straight away when it is already loaded', async () => {
    mockGetScheduledCall.mockResolvedValue(detail());
    store.dispatch(
      addRoom({
        roomData: {
          jid: 'app_room1@conference.xmpp.test',
          name: 'room',
          title: 'Room',
          messages: [],
        } as any,
      } as any)
    );
    signIn();
    store.dispatch(setConnectionState('online'));
    expect(openScheduledCall(SLUG)).toBe('opening');
    await flush();
    expect(store.getState().rooms.activeRoomJID).toBe(
      'app_room1@conference.xmpp.test'
    );
  });

  it.each([
    [{ name: 'ScheduledCallApiError', code: 'not-a-member' }, 'not-a-member'],
    [{ name: 'ScheduledCallApiError', code: 'not-found' }, 'not-found'],
    [{ name: 'ScheduledCallApiError', code: 'network' }, 'network'],
  ])('maps %p to the %s screen', async (error, reason) => {
    mockGetScheduledCall.mockRejectedValue(error);
    signIn();
    store.dispatch(setConnectionState('online'));
    openScheduledCall(SLUG);
    await flush();
    expect(scheduledCallUi.getState().preJoin).toMatchObject({
      phase: 'error',
      reason,
    });
  });

  it('tells config.scheduledCalls.onOpenError why a call did not open', async () => {
    const onOpenError = jest.fn();
    store.dispatch(
      setConfig({
        baseUrl: 'https://api.test',
        scheduledCalls: { onOpenError },
      } as any)
    );
    mockGetScheduledCall.mockRejectedValue({ name: 'ScheduledCallApiError', code: 'not-a-member' });
    signIn();
    store.dispatch(setConnectionState('online'));
    openScheduledCall(SLUG);
    await flush();
    expect(onOpenError).toHaveBeenCalledWith({ slug: SLUG, reason: 'not-a-member' });
  });

  it('shows "cancelled" and does not open the room', async () => {
    mockGetScheduledCall.mockResolvedValue(detail({ status: 'cancelled' }));
    signIn();
    store.dispatch(setConnectionState('online'));
    openScheduledCall(SLUG);
    await flush();
    expect(scheduledCallUi.getState().preJoin).toMatchObject({
      phase: 'error',
      reason: 'cancelled',
      title: 'Sync',
    });
    expect(store.getState().rooms.pendingNotificationJid).toBeNull();
  });

  it('handleScheduledCallUrl only takes scheduled-call links', () => {
    expect(handleScheduledCallUrl('https://example.com/other')).toBe(false);
    expect(handleScheduledCallUrl(undefined)).toBe(false);
    expect(
      handleScheduledCallUrl(`https://app.chat.ethora.com/call/${SLUG}`)
    ).toBe(true);
  });
});

describe('reminder push', () => {
  const push = {
    type: 'scheduledCallReminder',
    slug: SLUG,
    chatName: 'app_room1',
    startAt: '2026-11-03T14:30:00.000Z',
    joinUrl: `https://app.chat.ethora.com/call/${SLUG}`,
  };

  it('is recognised by its type', () => {
    expect(isScheduledCallReminderPush(push)).toBe(true);
    expect(isScheduledCallReminderPush({ type: 'message', jid: 'x' })).toBe(false);
    expect(isScheduledCallReminderPush(null)).toBe(false);
  });

  it('takes the slug, else the one in joinUrl', () => {
    expect(scheduledCallSlugFromPush(push)).toBe(SLUG);
    expect(scheduledCallSlugFromPush({ ...push, slug: '' })).toBe(SLUG);
    expect(scheduledCallSlugFromPush({ ...push, slug: 'x', joinUrl: 'nope' })).toBeNull();
    expect(scheduledCallSlugFromPush({ type: 'message', slug: SLUG })).toBeNull();
  });

  it('does not claim other pushes', () => {
    expect(handleScheduledCallPush({ type: 'message', jid: 'x@y' })).toBe(false);
  });
});

describe('handlePushPayload', () => {
  beforeEach(() => {
    __resetPendingScheduledCallForTests();
    store.dispatch(setUser({ token: '' } as any));
    store.dispatch(setConnectionState('offline'));
  });

  it('routes a reminder tap to the scheduled-call flow, held until ready', () => {
    const outcome = handlePushPayload({
      type: 'scheduledCallReminder',
      slug: SLUG,
      chatName: 'app_room1',
      jid: 'app_room1@conference.xmpp.test',
    });
    expect(outcome).toBe('scheduledCall');
    // Held, not mistaken for an ordinary room push.
    expect(store.getState().rooms.pendingNotificationJid).not.toBe(
      'app_room1@conference.xmpp.test'
    );
  });

  it('leaves ordinary pushes alone', () => {
    expect(handlePushPayload({ jid: 'x@conference.y' })).toBe('pending');
  });
});
