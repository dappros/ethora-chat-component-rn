/**
 * True while the pane should say "joining" instead of "choose a chat": the
 * requested room is not in the list yet and a join for exactly that room is
 * in flight (see useRoomInitialization).
 */
export const isJoiningRoom = (
  activeRoomJID: string | null | undefined,
  roomsList: Record<string, unknown> | undefined,
  joiningRoomJID: string | null | undefined
): boolean =>
  Boolean(activeRoomJID) &&
  !roomsList?.[activeRoomJID as string] &&
  joiningRoomJID === activeRoomJID;
