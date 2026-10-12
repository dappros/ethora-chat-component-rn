/**
 * Drop repeated entries from a room's member list, keeping the first.
 *
 * The same person could appear twice in a 1:1 chat ("Members: 3", four
 * rows): the list came back from the server with repeats after the private
 * chat was requested again for an existing room. Members are keyed by
 * whatever identity the entry carries: xmppUsername, then _id, then the
 * JID's localpart.
 */
export const uniqueMembers = <T,>(members: T[] | undefined | null): T[] => {
  if (!Array.isArray(members)) {return [];}
  const seen = new Set<string>();
  const out: T[] = [];
  for (const member of members) {
    const m = member as any;
    const key = String(
      m?.xmppUsername || m?._id || String(m?.jid || '').split('@')[0] || ''
    ).trim();
    if (key) {
      if (seen.has(key)) {continue;}
      seen.add(key);
    }
    out.push(member);
  }
  return out;
};
