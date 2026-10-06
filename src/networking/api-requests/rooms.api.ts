import { ApiRoom, DeleteRoomMember, PostAddRoomMember, PostReportRoom, PostRoom, RoomMember } from '../../types/models/room.model';
import { store } from '../../roomStore';
import { addRoom, mergeUsersSet, updateRoom } from '../../roomStore/roomsSlice';
import { IRoom } from '../../types/types';
import http from '../apiClient';

/**
 * Populate `state.rooms.usersSet` (the identity cache Message.tsx resolves
 * sender display names from) from the `members` arrays the REST `/chats/my`
 * response carries. This is how the web SDK hydrates usersSet — it does NOT
 * depend on the XMPP `getRoomMembers` IQ, which errors (`type=error`) on the
 * current backend and left every sender showing a raw JID instead of a name.
 *
 * Keying: a message sender's `user.id` localpart is `<appId>_<userId>`, but
 * a REST member only carries its Mongo `_id` (= `<userId>`). We derive the
 * appId from the logged-in user's own xmppUsername (also `<appId>_<userId>`)
 * and index each member under every id form a lookup might use:
 *   - `<appId>_<_id>`  (matches the message sender localpart — the key case)
 *   - `_id`            (fallback)
 *   - `xmppUsername`   (raw + localpart) when the API does return one
 */
const usableImage = (value: unknown): string => {
  const url = typeof value === 'string' ? value.trim() : '';
  return url && url !== 'none' ? url : '';
};

function dispatchUsersSetFromRestItems(items: ApiRoom[]): void {
  if (!items?.length) {return;}
  const ownXmpp = String(
    store.getState().chatSettingStore?.user?.xmppUsername || ''
  );
  const appId = ownXmpp.includes('_') ? ownXmpp.split('_')[0] : '';

  const known = (store.getState().rooms?.usersSet || {}) as Record<string, RoomMember>;
  const members: Record<string, RoomMember> = {};
  for (const item of items) {
    const list = Array.isArray((item as any)?.members) ? (item as any).members : [];
    for (const m of list) {
      if (!m) {continue;}
      const before: RoomMember | undefined =
        (m._id && (members[m._id] || known[m._id])) || undefined;
      const entry: RoomMember = {
        firstName: m.firstName ?? before?.firstName ?? '',
        lastName: m.lastName ?? before?.lastName ?? '',
        xmppUsername: m.xmppUsername || (appId && m._id ? `${appId}_${m._id}` : m._id || ''),
        _id: m._id || '',
        profileImage:
          m.profileImage !== undefined
            ? usableImage(m.profileImage)
            : before?.profileImage ?? '',
        description: m.description ?? before?.description,
        role: m.role,
        ban_status: m.ban_status,
        last_active: m.last_active,
        jid: m.jid,
        name: m.name,
      } as RoomMember;

      const keys = new Set<string>();
      if (appId && m._id) {keys.add(`${appId}_${m._id}`);}
      if (m._id) {keys.add(m._id);}
      if (m.xmppUsername) {
        keys.add(m.xmppUsername);
        keys.add(String(m.xmppUsername).split('@')[0]);
      }
      keys.forEach((k) => {
        if (k) {members[k] = entry;}
      });
    }
  }

  if (Object.keys(members).length > 0) {
    store.dispatch(mergeUsersSet({ members }));
  }
}

interface ApiRoomMember {
  _id: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Materialize a REST `/chats/my` item into an `IRoom` + dispatch
 * `addRoom`. Without this, REST-fetched rooms never make it into
 * `state.rooms.rooms` and `ChatRoom` falls back to the "no rooms,
 * create one!" empty state even when the user has rooms server-side.
 *
 * The room jid is derived from the conference host. We try several
 * places:
 *   1. explicit `room.jid` from the server (if present)
 *   2. `<name>@conference.<xmppHost>` where xmppHost comes from the
 *      provider's `xmppSettings.host` saved to `chatSettingStore.config`
 *   3. derive host from `config.baseUrl` (api.<host> → xmpp.<host>)
 *      as a last-resort heuristic for misconfigured deployments
 *   4. otherwise: skip the room with a warn log (NEVER fall back to a
 *      hardcoded vendor host — previously `xmpp.chat.ethora.com`, which
 *      manifested as a phantom "ethora" room stub on third-party servers,
 *      customer-reported #23)
 */
export function memberAccount(member: any, appId: string): string {
  const explicit = String(member?.xmppUsername || '').split('@')[0];
  if (explicit) {return explicit;}
  return appId && member?._id ? `${appId}_${member._id}` : '';
}

export function ownAppId(): string {
  const ownXmpp = String(
    store.getState().chatSettingStore?.user?.xmppUsername || ''
  );
  return ownXmpp.includes('_') ? ownXmpp.split('_')[0]! : '';
}

const toRoomMembers = (members: any[] | undefined): RoomMember[] => {
  const known = (store.getState().rooms?.usersSet || {}) as Record<string, RoomMember>;
  return (members || []).map((m: any) => ({
    firstName: m.firstName,
    lastName: m.lastName,
    profileImage:
      m.profileImage !== undefined
        ? usableImage(m.profileImage)
        : known[m._id]?.profileImage ?? '',
    xmppUsername: m._id || '',
    role: m.role,
    ban_status: m.ban_status,
    last_active: m.last_active,
    jid: m.jid || '',
  })) as any;
};

const toE2eeMembers = (members: any[] | undefined, appId: string): RoomMember[] =>
  (members || [])
    .map((m: any) => ({
      _id: m._id || '',
      firstName: m.firstName || '',
      lastName: m.lastName || '',
      xmppUsername: memberAccount(m, appId),
    }))
    .filter((m) => m.xmppUsername) as RoomMember[];

const memberCount = (item: ApiRoom): number =>
  item.usersCnt ?? item.participants ?? item.members?.length ?? 0;

function dispatchRoomsFromRestItems(items: ApiRoom[]): void {
  if (!items?.length) return;
  const config = store.getState().chatSettingStore?.config as any;
  const appId = ownAppId();
  // Best: explicit xmpp settings.
  let host: string | undefined =
    config?.xmppSettings?.host ||
    config?.xmppSettings?.conference?.replace(/^conference\./, '');
  // Heuristic fallback: derive xmpp host from the REST baseUrl.
  // `https://api.foo.com/v1` → `xmpp.foo.com`. Better than a hardcoded
  // vendor host and right in 99% of single-domain deployments.
  if (!host && typeof config?.baseUrl === 'string') {
    const m = /^https?:\/\/(?:api\.)?([^/]+)/i.exec(config.baseUrl);
    if (m && m[1]) {host = `xmpp.${m[1].replace(/^api\./, '')}`;}
  }
  const conference = config?.xmppSettings?.conference
    || (host ? `conference.${host}` : undefined);

  for (const item of items) {
    if (!item) continue;
    let jid = item.jid;
    if (!jid) {
      if (!conference) {
        // No server-supplied JID and no way to synthesize one safely —
        // skip rather than create a phantom room on a wrong host.
        // Consumers who hit this should set config.xmppSettings.host.
        console.warn(
          `[ethora-rn] rooms.api: skipping room "${item.name}" — no item.jid and no xmppSettings.host / baseUrl to derive host from`
        );
        continue;
      }
      jid = `${item.name}@${conference}`;
    }
    if (!jid.includes('@')) continue;
    const known = store.getState().rooms.rooms?.[jid];
    const preview = (item.members?.length ?? 0) < memberCount(item);
    const keep = <T,>(fresh: T[], existing: T[] | undefined): T[] =>
      preview && (existing?.length ?? 0) > fresh.length ? existing! : fresh;
    const room: IRoom = {
      id: item._id || jid,
      jid,
      name: item.name,
      title: item.title || item.name,
      usersCnt: memberCount(item),
      messages: [],
      isLoading: false,
      roomBg: '',
      icon: item.picture || item.icon,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      muted: item.muted === true,
      description: (item as any).description,
      type: (item as any).type,

      ...(item.e2ee === true
        ? {
            e2ee: true,
            members: keep(toE2eeMembers(item.members, appId), known?.members),
          }
        : {}),
      roomMembers: keep(toRoomMembers(item.members), known?.roomMembers),
    };
    store.dispatch(addRoom({ roomData: room }));
  }
  // Hydrate the sender-name identity cache from the same REST payload.
  dispatchUsersSetFromRestItems(items);
}

const ROOM_MEMBERS_TTL_MS = 5 * 60_000;
const roomMembersLoads = new Map<string, { at: number; done: Promise<boolean> }>();

/**
 * Fetches the room's own REST record (`/chats/my/{name}`) and applies what
 * only the backend knows: the full roster, and whether the room is
 * end-to-end encrypted. Skipped while the roster is already complete,
 * unless `force` - a room that arrived through XMPP (the room list
 * stanza, an invite) was never described by REST at all, so it has no
 * `e2ee` and shows no padlock until this runs.
 */
export function loadRoomMembers(
  roomJid: string,
  options: { force?: boolean } = {}
): Promise<boolean> {
  const jid = String(roomJid || '').split('/')[0]!;
  const room = store.getState().rooms.rooms?.[jid];
  if (!room) {return Promise.resolve(false);}
  if (
    !options.force &&
    (room.roomMembers?.length ?? 0) >= Number(room.usersCnt || 0)
  ) {
    return Promise.resolve(false);
  }
  const running = roomMembersLoads.get(jid);
  if (running && Date.now() - running.at < ROOM_MEMBERS_TTL_MS) {return running.done;}

  const done = (async () => {
    try {
      const response: any = await getRoomByName(jid.split('@')[0]!);
      const item: ApiRoom = response?.result ?? response;
      const members = Array.isArray(item?.members) ? item.members : [];
      if (!item || typeof item !== 'object') {return false;}
      dispatchUsersSetFromRestItems([item]);
      const current = store.getState().rooms.rooms?.[jid];
      if (!current) {return false;}
      const e2ee = item.e2ee === true || current.e2ee === true;
      store.dispatch(
        updateRoom({
          jid,
          updates: {
            ...(members.length > 0
              ? {
                  roomMembers: toRoomMembers(members),
                  usersCnt: Math.max(memberCount(item), members.length),
                }
              : {}),
            ...(e2ee ? { e2ee: true } : {}),
            ...(e2ee && members.length > 0
              ? { members: toE2eeMembers(members, ownAppId()) }
              : {}),
            // What the stanza list did not carry.
            ...(!current.title && item.title ? { title: item.title } : {}),
            ...(!current.icon && (item.picture || item.icon)
              ? { icon: item.picture || item.icon }
              : {}),
            ...(!current.type && (item as any).type ? { type: (item as any).type } : {}),
          },
        })
      );
      return members.length > 0;
    } catch (error) {
      roomMembersLoads.delete(jid);
      console.warn('[ethora-rn] rooms.api: could not load room members', jid, error);
      return false;
    }
  })();
  roomMembersLoads.set(jid, { at: Date.now(), done });
  return done;
}

const GET_ROOMS_CACHE_MS = 60_000;
let getRoomsInFlight: Promise<{ items: ApiRoom[] }> | null = null;
let getRoomsInFlightToken = '';
let lastGetRoomsResponse: { items: ApiRoom[] } | null = null;
let lastGetRoomsResponseAt = 0;
let lastGetRoomsResponseToken = '';

/**
 * REST equivalent of getRoomsStanza. Used by initBeforeLoad to prefetch
 * the room list in parallel with the XMPP handshake. Results are cached
 * per-token for 60s so a downstream re-fetch on mount is a no-op.
 */
export async function getRooms(): Promise<{ items: ApiRoom[] }> {
  const token = store.getState().chatSettingStore.user.token || '';
  const now = Date.now();

  if (
    lastGetRoomsResponse &&
    lastGetRoomsResponseToken === token &&
    now - lastGetRoomsResponseAt < GET_ROOMS_CACHE_MS
  ) {
    return lastGetRoomsResponse;
  }

  if (getRoomsInFlight && getRoomsInFlightToken === token) {
    return getRoomsInFlight;
  }

  getRoomsInFlightToken = token;
  getRoomsInFlight = (async () => {
    const response = await http.get('/v1/chats/my', {
      headers: { Authorization: token },
    });
    lastGetRoomsResponse = response.data;
    lastGetRoomsResponseAt = Date.now();
    lastGetRoomsResponseToken = token;
    dispatchRoomsFromRestItems(response.data?.items || []);
    return response.data;
  })();

  try {
    return await getRoomsInFlight;
  } catch (error) {
    console.log('Error loading rooms via REST', error);
    return { items: [] };
  } finally {
    getRoomsInFlight = null;
    getRoomsInFlightToken = '';
  }
}

export async function getRoomByName(chatName: string): Promise<ApiRoom> {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.get(`/v1/chats/my/${chatName}`, {
      headers: {
        Authorization: token,
      },
    });
    return response.data;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function postRoom(data: PostRoom) {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post('/v1/chats', data, {
      headers: {
        Authorization: token,
      },
    });
    return response.data.result;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function postPrivateRoom(
  username: string,
  e2ee: boolean = false
): Promise<ApiRoom> {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post(
      '/v1/chats/private',
      e2ee === true ? { username, e2ee: true } : { username },
      {
        headers: {
          Authorization: token,
        },
      }
    );
    return response.data.result;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function setRoomMuted(chatName: string, muted: boolean): Promise<boolean> {
  const token = store.getState().chatSettingStore.user.token || '';
  const url = `/v1/chats/my/${encodeURIComponent(chatName)}/mute`;
  const config = { headers: { Authorization: token } };
  const response = muted ? await http.put(url, {}, config) : await http.delete(url, config);
  return response.data?.result?.muted ?? muted;
}

export async function postReportRoom(data: PostReportRoom) {
  const { chatName, category, text } = data;
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post(
      `/v1/chats/reports/${chatName}`,
      { category, text },
      {
        headers: {
          Authorization: token,
        },
      }
    );
    return response.data.result;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function postAddRoomMember(
  data: PostAddRoomMember
): Promise<RoomMember[]> {
  const { chatName, members } = data;
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post(
      `/v1/chats/users-access`,
      { chatName, members },
      {
        headers: {
          Authorization: token,
        },
      }
    );
    return response?.data?.results || [];
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function deleteRoomMember(data: DeleteRoomMember) {
  const { roomId, members } = data;
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.delete(`/v1/chats/users-access`, {
      headers: {
        Authorization: token,
      },
      data: {
        chatName: roomId,
        members,
      },
    });
    return response.data.result;
  } catch (error) {
    throw new Error('Error updating profile');
  }
}

export async function deleteRoom(name: string) {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.delete('/v1/chats', {
      headers: {
        Authorization: token,
      },
      data: { name },
    });
    return response.data.result;
  } catch (error) {
    throw new Error('Error deleting room');
  }
}

// POST /v1/chats/call/create/{chatName}
// Swagger documents the body as `additionalProperties: true`, we forward
// `kind: 'audio' | 'video'` so the server can stamp it on the broadcast
// call-token stanza for the callee. When the server doesn't recognize the
// field both sides still fall through to a video call (the default), which
// matches the prior single-mode behavior.
// No timeout is set on the shared `http` client (matches web — neither SDK
// configures one anywhere), so a stalled connection leaves this request
// hanging indefinitely with nothing surfaced to the caller. Observed live
// on the iOS Simulator: the same call the backend answers in ~0.6s from a
// plain curl sat unresolved for 75+ seconds through the Simulator's network
// stack. The UI's own 30s "no answer" ring timeout (VideoCallOverlay)
// doesn't touch this request at all — it just gives up and shows an error
// while the POST keeps sitting there, so a request that DOES eventually
// resolve races a call the user already dismissed. Bound just this
// request, not the shared client: file uploads on the same client
// legitimately take longer than any call-placement call should ever need.
const CALL_CREATE_TIMEOUT_MS = 15000;

export async function createChatCall(
  chatName: string,
  options?: { kind?: 'audio' | 'video' }
): Promise<void> {
  const token = store.getState().chatSettingStore.user.token || '';
  const kind = options?.kind || 'video';

  try {
    await http.post(
      `/v1/chats/call/create/${chatName}`,
      { kind },
      {
        headers: {
          Authorization: token,
        },
        timeout: CALL_CREATE_TIMEOUT_MS,
      }
    );
  } catch (error: any) {
    // Distinguish a timeout from a real server rejection — the caller
    // (CallButtons) surfaces this string directly on the ring/error
    // screen, and "the network is being slow" is a very different thing
    // to tell the user than "the server said no".
    if (error?.code === 'ECONNABORTED' || /timeout/i.test(String(error?.message))) {
      throw new Error('Call request timed out — check your connection and try again');
    }
    throw new Error('Error creating chat call');
  }
}

export function clearRoomsRestCache() {
  roomMembersLoads.clear();
  lastGetRoomsResponse = null;
  lastGetRoomsResponseAt = 0;
  lastGetRoomsResponseToken = '';
}

export type { ApiRoom };
