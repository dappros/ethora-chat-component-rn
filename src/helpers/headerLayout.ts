/** @format */

/**
 * Default (and minimum) height in px of the header content band — the bar
 * itself, NOT counting the status-bar safe-area inset that sits above it.
 *
 * This single value is the "common denominator" shared by BOTH headers:
 *   • the in-chat header (ChatHeader / ChatContainerHeader), and
 *   • the full-screen modal header (ModalHeaderComponent / HeaderContainer)
 * so they render at the same visible height below the status bar.
 *
 * It's also the floor: 64px comfortably fits the 40px avatar / back button
 * plus breathing room. A smaller band clips that content, so configured
 * values at or below this are ignored (see `resolveHeaderHeight`).
 */
export const DEFAULT_HEADER_HEIGHT = 64;

/**
 * Resolve the effective header band height from an optional config override.
 *
 * The override can only make the header TALLER, never shorter than the
 * default — a value <= DEFAULT_HEADER_HEIGHT (or non-numeric) is ignored and
 * the default is used, so a too-small number (e.g. 10) can't collapse the
 * bar and break its layout. Only a value strictly greater than the default
 * takes effect.
 */
export const resolveHeaderHeight = (height?: number): number =>
  typeof height === 'number' && height > DEFAULT_HEADER_HEIGHT
    ? height
    : DEFAULT_HEADER_HEIGHT;
