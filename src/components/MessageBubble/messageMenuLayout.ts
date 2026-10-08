/** @format */

/** Space between the reaction bar, the message and the menu. */
export const STACK_GAP = 8;
/** A message too tall for the screen is cut to at least this much. */
const MIN_PREVIEW_HEIGHT = 64;

export interface StackInput {
  /** The bubble's box, window coordinates. */
  bubble: { top: number; bottom: number };
  barHeight: number;
  menuHeight: number;
  /** Visible band the stack must fit in, window coordinates. */
  areaTop: number;
  areaBottom: number;
}

export interface StackLayout {
  barTop: number;
  previewTop: number;
  previewHeight: number;
  menuTop: number;
}

/**
 * Reaction bar above the message, menu below it, all three on screen and
 * never on top of each other. The message stays where it is when that
 * fits; otherwise the whole stack moves (up from the input, down from the
 * header), and a message taller than what is left is cut.
 */
export const layoutStack = ({
  bubble,
  barHeight,
  menuHeight,
  areaTop,
  areaBottom,
}: StackInput): StackLayout => {
  const above = barHeight > 0 ? barHeight + STACK_GAP : 0;
  const below = STACK_GAP + menuHeight;
  const room = areaBottom - areaTop - above - below;
  const bubbleHeight = bubble.bottom - bubble.top;
  // Cut only what does not fit (and never below a readable minimum).
  const previewHeight =
    bubbleHeight <= room ? bubbleHeight : Math.max(MIN_PREVIEW_HEIGHT, room);

  let previewTop = bubble.top;
  // Out at the bottom: lift the stack.
  const overflow = previewTop + previewHeight + below - areaBottom;
  if (overflow > 0) {previewTop -= overflow;}
  // Out at the top (a message under the header, or lifted too far): drop it.
  if (previewTop - above < areaTop) {previewTop = areaTop + above;}

  return {
    barTop: previewTop - above,
    previewTop,
    previewHeight,
    menuTop: previewTop + previewHeight + STACK_GAP,
  };
};
