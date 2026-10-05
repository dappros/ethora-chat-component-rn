/**
 * Starting the MUC join sweep without ever waiting for it.
 *
 * The room list is usable as soon as /chats/my has returned (rooms are
 * seeded with lastMessage / unread / usersCnt), so joining every room is a
 * background job: open room first, then recent activity, a few at a time.
 */

type SweepClient = { sendAllPresencesAndMarkReady?: () => Promise<unknown> };

// Fire-and-forget: never awaited by the room list, never throws.
export const startBackgroundJoinSweep = (client: SweepClient | null | undefined) => {
  if (!client || typeof client.sendAllPresencesAndMarkReady !== 'function') {
    return;
  }
  Promise.resolve()
    .then(() => client.sendAllPresencesAndMarkReady?.())
    .catch((error) => {
      console.warn('[loadRooms] background join sweep failed', error);
    });
};

// Ends the loading state right after the rooms fetch and joins in the
// background. Resolves without waiting for any join; a failing fetch starts
// no sweep and never calls `onListReady`.
export const loadRoomsThenJoinInBackground = async <T,>(
  client: SweepClient,
  fetchRooms: () => Promise<T>,
  onListReady: () => void
): Promise<T> => {
  const rooms = await fetchRooms();
  startBackgroundJoinSweep(client);
  onListReady();
  return rooms;
};
