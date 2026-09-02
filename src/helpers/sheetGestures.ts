/** @format */

/**
 * Shared thresholds for the drag-to-dismiss gesture on bottom sheets (the
 * attach sheet, the profile headers, the room-list menu). Kept in one
 * place so a pull feels identical wherever the user does it — and so the
 * numbers are unit-testable without a touch event.
 */

/** Drag past this many points and letting go dismisses the sheet. */
export const DISMISS_DISTANCE = 90;
/** …or flick faster than this, however short the drag. */
export const DISMISS_VELOCITY = 0.8;

/**
 * Claim a drag only once it is clearly a downward pull, so a tap on a row
 * still registers and a horizontal swipe stays with whatever scrolls
 * sideways inside the sheet.
 */
export const shouldClaimVerticalDrag = (dy: number, dx: number) =>
  dy > 6 && Math.abs(dy) > Math.abs(dx) * 1.5;

/** Far enough / fast enough to let go of the sheet. */
export const shouldDismissOnDrag = (dy: number, vy: number) =>
  dy > DISMISS_DISTANCE || vy > DISMISS_VELOCITY;
