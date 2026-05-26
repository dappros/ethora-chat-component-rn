import { ApiRoom, DeleteRoomMember, PostAddRoomMember, PostReportRoom, PostRoom, RoomMember } from '../../types/models/room.model';
import { store } from '../../roomStore';
import { addRoom } from '../../roomStore/roomsSlice';
import { IRoom } from '../../types/types';
import http from '../apiClient';

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
 *   3. fallback: `<name>@conference.xmpp.chat.ethora.com`
 */
function dispatchRoomsFromRestItems(items: ApiRoom[]): void {
  if (!items?.length) return;
  const config = store.getState().chatSettingStore?.config as any;
  const host: string =
    config?.xmppSettings?.host ||
    config?.xmppSettings?.conference?.replace(/^conference\./, '') ||
    'xmpp.chat.ethora.com';
  const conference =
    config?.xmppSettings?.conference || `conference.${host}`;

  for (const item of items) {
    if (!item) continue;
    const jid = item.jid || `${item.name}@${conference}`;
    if (!jid.includes('@')) continue;
    const room: IRoom = {
      id: item._id || jid,
      jid,
      name: item.name,
      title: item.title || item.name,
      usersCnt: item.participants ?? item.members?.length ?? 0,
      messages: [],
      isLoading: false,
      roomBg: '',
      icon: item.picture || item.icon,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      description: (item as any).description,
      type: (item as any).type,
      // ChatProfileModal renders this list under the description/type
      // fields. The REST API returns `members` (an array of {_id,
      // firstName?, lastName?}); map to the shape RoomMember expects.
      roomMembers: (item.members || []).map((m: any) => ({
        firstName: m.firstName,
        lastName: m.lastName,
        xmppUsername: m._id || '',
        role: m.role,
        ban_status: m.ban_status,
        last_active: m.last_active,
        jid: m.jid || '',
      })) as any,
    };
    store.dispatch(addRoom({ roomData: room }));
  }
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
    const response = await http.get('/chats/my', {
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
    const response = await http.get(`/chats/my/${chatName}`, {
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
    const response = await http.post('/chats', data, {
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
  title: string = 'Private chat'
): Promise<ApiRoom> {
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post(
      '/chats/private',
      { username },
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

export async function postReportRoom(data: PostReportRoom) {
  const { chatName, category, text } = data;
  const token = store.getState().chatSettingStore.user.token || '';

  try {
    const response = await http.post(
      `/chats/reports/${chatName}`,
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
      `/chats/users-access`,
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
    const response = await http.delete(`/chats/users-access`, {
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
    const response = await http.delete('/chats', {
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

export function clearRoomsRestCache() {
  lastGetRoomsResponse = null;
  lastGetRoomsResponseAt = 0;
  lastGetRoomsResponseToken = '';
}

export type { ApiRoom };
