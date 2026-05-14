import { store } from '../../roomStore';
import http from '../apiClient';

interface ApiRoom {
  name: string;
  title?: string;
  jid?: string;
  description?: string;
  participants?: number;
  type?: string;
  icon?: string;
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

export function clearRoomsRestCache() {
  lastGetRoomsResponse = null;
  lastGetRoomsResponseAt = 0;
  lastGetRoomsResponseToken = '';
}

export type { ApiRoom };
