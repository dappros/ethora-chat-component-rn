import type { CallParticipantView } from './callSessionTypes';

/**
 * Pure layout decisions of the group call grid, kept apart from the view so
 * they can be tested on their own.
 */

/**
 * Most camera surfaces rendered at once. A phone cannot decode and draw 50
 * videos; the rest of the room shows as avatars until they speak. A track
 * with no surface attached is also not requested from the server
 * (adaptiveStream), so this bounds the bandwidth too.
 */
export const MAX_VIDEO_TILES = 9;

/** Columns of the grid for `count` participants. */
export const gridColumns = (count: number, landscape: boolean): number => {
  if (count <= 1) return 1;
  if (count <= 4) return landscape ? Math.min(count, 4) : 2;
  return landscape ? 4 : 3;
};

/**
 * Which participants get a live video surface. Whoever is speaking comes
 * first, then us, then everyone else in grid order, until the budget is
 * used. Participants without a live camera never take a slot.
 */
export const pickVideoTiles = (
  participants: CallParticipantView[],
  max: number = MAX_VIDEO_TILES
): Set<string> => {
  const withVideo = participants.filter((p) => !!p.video);
  const ranked = [
    ...withVideo.filter((p) => p.speaking),
    ...withVideo.filter((p) => !p.speaking && p.isLocal),
    ...withVideo.filter((p) => !p.speaking && !p.isLocal),
  ];
  return new Set(ranked.slice(0, Math.max(0, max)).map((p) => p.identity));
};

/** Names of the people currently speaking, for the header line. */
export const speakingNames = (
  participants: CallParticipantView[],
  youLabel: string
): string[] =>
  participants
    .filter((p) => p.speaking)
    .map((p) => (p.isLocal ? youLabel : p.name));
