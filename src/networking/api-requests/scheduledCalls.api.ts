import http from '../apiClient';
import { store } from '../../roomStore';

/**
 * Scheduled calls (booking). Wrappers for `/v1/chats/calls/scheduled`.
 *
 * The backend decides every link: the join link, the .ics download and the
 * Google / Outlook templates come back in `links`, and the client only opens
 * them. No calendar URL is ever built here.
 */

export type ScheduledCallKind = 'video' | 'audio';
export type ScheduledCallRecordStatus = 'scheduled' | 'cancelled';

export interface ScheduledCall {
  id?: string;
  chatName: string;
  chatType?: 'private' | 'group' | 'public' | string;
  createdBy?: string;
  title: string;
  description?: string;
  /** ISO 8601, UTC. */
  startAt: string;
  durationMinutes: number;
  timezone?: string;
  kind: ScheduledCallKind;
  slug: string;
  status: ScheduledCallRecordStatus;
  sequence?: number;
}

export interface ScheduledCallLinks {
  join: string;
  ics?: string;
  google?: string;
  outlook?: string;
  office365?: string;
}

export interface ScheduledCallChat {
  name?: string;
  title?: string;
  type?: string;
  jid?: string;
}

export interface ScheduledCallDetail {
  scheduledCall: ScheduledCall;
  links: ScheduledCallLinks;
  /** Only the single-call GET carries it. */
  chat?: ScheduledCallChat;
}

export interface CreateScheduledCallInput {
  /** The bare room name (JID localpart), as the call endpoints take it. */
  chatName: string;
  title?: string;
  description?: string;
  /** ISO 8601. */
  startAt: string;
  durationMinutes?: number;
  timezone?: string;
  kind?: ScheduledCallKind;
}

export interface UpdateScheduledCallInput {
  title?: string;
  description?: string;
  startAt?: string;
  durationMinutes?: number;
  kind?: ScheduledCallKind;
}

export type ScheduledCallErrorCode =
  | 'not-found'
  | 'not-a-member'
  | 'forbidden'
  | 'invalid'
  | 'conflict'
  | 'network'
  | 'unknown';

export class ScheduledCallApiError extends Error {
  code: ScheduledCallErrorCode;
  status?: number;
  /** The server's own `code` (e.g. `START_IN_PAST`, `CALL_CANCELLED`), when it sent one. */
  serverCode?: string;
  constructor(
    code: ScheduledCallErrorCode,
    status?: number,
    message?: string,
    serverCode?: string
  ) {
    super(message || code);
    this.name = 'ScheduledCallApiError';
    this.code = code;
    this.status = status;
    this.serverCode = serverCode;
  }
}

export const isScheduledCallApiError = (
  error: unknown
): error is ScheduledCallApiError =>
  error instanceof ScheduledCallApiError ||
  (!!error && (error as any).name === 'ScheduledCallApiError');

const REQUEST_TIMEOUT_MS = 15000;
const BASE = '/v1/chats/calls/scheduled';

const authHeaders = () => ({
  Authorization: store.getState().chatSettingStore.user?.token || '',
});

const toApiError = (error: any): ScheduledCallApiError => {
  const status: number | undefined = error?.response?.status;
  const body = error?.response?.data;
  const reason = String(body?.error || body?.message || '');
  const serverCode = body?.code ? String(body.code) : undefined;
  if (!error?.response) {
    return new ScheduledCallApiError('network', undefined, error?.message);
  }
  if (status === 404) {return new ScheduledCallApiError('not-found', status, reason, serverCode);}
  if (status === 403) {
    return new ScheduledCallApiError(
      reason === 'not-a-member' ? 'not-a-member' : 'forbidden',
      status,
      reason,
      serverCode
    );
  }
  if (status === 400 || status === 422) {
    return new ScheduledCallApiError('invalid', status, reason, serverCode);
  }
  // PATCH on a cancelled call.
  if (status === 409) {
    return new ScheduledCallApiError('conflict', status, reason, serverCode);
  }
  return new ScheduledCallApiError(
    'unknown',
    status,
    reason || error?.message,
    serverCode
  );
};

const pick = (data: any): ScheduledCallDetail => {
  const scheduledCall = data?.scheduledCall;
  if (!scheduledCall || typeof scheduledCall !== 'object') {
    throw new ScheduledCallApiError('unknown', undefined, 'bad response');
  }
  return {
    scheduledCall,
    links: data?.links || { join: '' },
    ...(data?.chat ? { chat: data.chat } : {}),
  };
};

const run = async <T>(call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch (error) {
    if (isScheduledCallApiError(error)) {throw error;}
    throw toApiError(error);
  }
};

/** POST /v1/chats/calls/scheduled */
export const createScheduledCall = (
  input: CreateScheduledCallInput
): Promise<ScheduledCallDetail> =>
  run(async () => {
    const response = await http.post(BASE, input, {
      headers: authHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return pick(response?.data);
  });

/** GET /v1/chats/calls/scheduled?chatName=&from=&to= (upcoming first). */
export const listScheduledCalls = (params: {
  chatName?: string;
  from?: string;
  to?: string;
}): Promise<ScheduledCallDetail[]> =>
  run(async () => {
    const response = await http.get(BASE, {
      params,
      headers: authHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    const items = response?.data?.items;
    return Array.isArray(items) ? items.map(pick) : [];
  });

/** GET /v1/chats/calls/scheduled/:slug. 404 unknown, 403 not a member. */
export const getScheduledCall = (slug: string): Promise<ScheduledCallDetail> =>
  run(async () => {
    const response = await http.get(`${BASE}/${encodeURIComponent(slug)}`, {
      headers: authHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
    });
    return pick(response?.data);
  });

/** PATCH /v1/chats/calls/scheduled/:slug (creator or room owner). */
export const updateScheduledCall = (
  slug: string,
  patch: UpdateScheduledCallInput
): Promise<ScheduledCallDetail> =>
  run(async () => {
    const response = await http.patch(
      `${BASE}/${encodeURIComponent(slug)}`,
      patch,
      { headers: authHeaders(), timeout: REQUEST_TIMEOUT_MS }
    );
    return pick(response?.data);
  });

/** DELETE /v1/chats/calls/scheduled/:slug (creator or room owner). */
export const cancelScheduledCall = (slug: string): Promise<ScheduledCall> =>
  run(async () => {
    const response = await http.delete(
      `${BASE}/${encodeURIComponent(slug)}`,
      { headers: authHeaders(), timeout: REQUEST_TIMEOUT_MS }
    );
    const scheduledCall = response?.data?.scheduledCall;
    if (!scheduledCall) {
      throw new ScheduledCallApiError('unknown', undefined, 'bad response');
    }
    return scheduledCall as ScheduledCall;
  });
