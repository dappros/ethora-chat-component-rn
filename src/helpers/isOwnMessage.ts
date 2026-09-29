import { IMessage } from '../types/types';

/**
 * Bug #41: during reconnect catch-up (app was backgrounded/offline, then
 * comes back online), messages replayed from MAM could transiently render
 * on the RIGHT (as if sent by the current user) before flipping to the
 * LEFT a moment later. Root cause: `message.user.id === walletAddress`
 * treats `undefined === undefined` (or `'' === ''`) as a match, and the
 * two sides could independently be empty for one frame -- the message's
 * sender id before the MAM-derived value settled, and/or the current
 * user's id before it rehydrated. Two blank ids must never compare equal.
 *
 * A second, related issue: the same logical sender id can show up in
 * different shapes depending on which code path produced it -- a bare
 * id ("wallet123") or a bare JID with an incidental session resource
 * ("wallet123@host/sessionResource", as `senderJID` attrs carry on the
 * wire -- see src/assets/test.xml). In every shape used in this
 * codebase the identifying segment is the part BEFORE the first '@' (or
 * before '/' when there's no '@'); anything after that -- domain,
 * resource -- is noise. Comparing raw strings with `===` fails whenever
 * one side still carries that noise and the other doesn't. Normalizing
 * both sides (strip resource, strip domain, lowercase) before comparing
 * makes the check tolerant of that drift.
 */

export interface OwnMessageUserLike {
  id?: string | null;
  xmppUsername?: string | null;
  walletAddress?: string | null;
}

export type OwnMessageCurrentUser =
  | OwnMessageUserLike
  | string
  | null
  | undefined;

/**
 * Strip a MUC resource (`room@host/resource` -> `room@host`) and then a
 * JID domain (`local@host` -> `local`), lowercasing the result. Applies
 * to both plain ids and full/partial JIDs so either shape normalizes to
 * the same comparable value.
 */
const normalizeId = (raw: unknown): string => {
  const value = String(raw ?? '').trim();
  if (!value) {
    return '';
  }
  const withoutResource = value.split('/')[0];
  const withoutDomain = withoutResource.includes('@')
    ? withoutResource.split('@')[0]
    : withoutResource;
  return withoutDomain.toLowerCase();
};

// Same precedence the rest of the app uses when it needs "who am I" as a
// single id: xmppUsername first, walletAddress as the fallback.
const resolveCurrentUserId = (currentUser: OwnMessageCurrentUser): string => {
  if (typeof currentUser === 'string') {
    return currentUser;
  }
  if (!currentUser) {
    return '';
  }
  return (
    currentUser.xmppUsername || currentUser.walletAddress || currentUser.id || ''
  );
};

/**
 * Robustly determine whether `message` was sent by `currentUser`. Never
 * returns true from two blank/undefined ids, and tolerates bare-id vs.
 * full-JID mismatches between the sender id and the current user id.
 */
export const isOwnMessage = (
  message: Pick<IMessage, 'user'> | null | undefined,
  currentUser: OwnMessageCurrentUser
): boolean => {
  const messageUserId = normalizeId(message?.user?.id);
  if (!messageUserId) {
    return false;
  }

  const currentUserId = normalizeId(resolveCurrentUserId(currentUser));
  if (!currentUserId) {
    return false;
  }

  return messageUserId === currentUserId;
};
