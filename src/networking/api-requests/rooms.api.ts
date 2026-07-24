import { ApiRoom, DeleteRoomMember, PostAddRoomMember, PostReportRoom, PostRoom, RoomMember } from '../../types/models/room.model';
import { store } from '../../roomStore';
import { addRoom, mergeUsersSet } from '../../roomStore/roomsSlice';
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
function dispatchUsersSetFromRestItems(items: ApiRoom[]): void {
  if (!items?.length) {return;}
  const ownXmpp = String(
    store.getState().chatSettingStore?.user?.xmppUsername || ''
  );
  const appId = ownXmpp.includes('_') ? ownXmpp.split('_')[0] : '';

  const members: Record<string, RoomMember> = {};
  for (const item of items) {
    const list = Array.isArray((item as any)?.members) ? (item as any).members : [];
    for (const m of list) {
      if (!m) {continue;}
      const entry: RoomMember = {
        firstName: m.firstName || '',
        lastName: m.lastName || '',
        xmppUsername: m.xmppUsername || (appId && m._id ? `${appId}_${m._id}` : m._id || ''),
        _id: m._id || '',
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
function dispatchRoomsFromRestItems(items: ApiRoom[]): void {
  if (!items?.length) return;
  const config = store.getState().chatSettingStore?.config as any;
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
  // Hydrate the sender-name identity cache from the same REST payload.
  dispatchUsersSetFromRestItems(items);
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

// POST /v1/chats/call/create/{chatName}
// Swagger documents the body as `additionalProperties: true`, we forward
// `kind: 'audio' | 'video'` so the server can stamp it on the broadcast
// call-token stanza for the callee. When the server doesn't recognize the
// field both sides still fall through to a video call (the default), which
// matches the prior single-mode behavior.
export async function createChatCall(
  chatName: string,
  options?: { kind?: 'audio' | 'video' }
): Promise<void> {
  const token = store.getState().chatSettingStore.user.token || '';
  const kind = options?.kind || 'video';

  try {
    await http.post(
      `/chats/call/create/${chatName}`,
      { kind },
      {
        headers: {
          Authorization: token,
        },
      }
    );
  } catch (error) {
    throw new Error('Error creating chat call');
  }
}

export function clearRoomsRestCache() {
  lastGetRoomsResponse = null;
  lastGetRoomsResponseAt = 0;
  lastGetRoomsResponseToken = '';
}

export type { ApiRoom };
