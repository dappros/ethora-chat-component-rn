/**
 * Whether a resolved sender "name" is really just an unresolved id.
 *
 * The name chain ends at the sender's JID localpart when `usersSet` has no
 * entry and the wire carried no name. For a real member that never happens
 * for long — the REST roster fills the cache in. But some senders are not
 * members at all: a broadcast posted by the app itself arrives with the
 * ROOM's own id as its occupant resource (e.g.
 * `646cc8dc96d4a4dc8f7b2f2d_67f6823cf5995841ba431f06`), so no roster will
 * ever resolve it and the bubble ends up captioned with 50 characters of
 * hex.
 *
 * Ethora ids are `<24-hex appId>_<24-hex objectId>`, which is what this
 * matches. A raw objectId on its own is matched too, since some senders
 * carry only that half.
 */
const ETHORA_ID = /^[0-9a-f]{24}(_[0-9a-f]{24})?$/i;

export const isUnresolvedSenderId = (name?: string): boolean => {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return true;
  }
  return ETHORA_ID.test(trimmed);
};
