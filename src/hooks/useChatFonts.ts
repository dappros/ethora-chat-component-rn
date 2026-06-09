import React, { useEffect, useState } from 'react';
import { Text, TextInput } from 'react-native';
import type { TypographyConfig } from '../types/types';

/**
 * Loads and applies the host-provided font configuration for the chat UI.
 *
 * React Native has no web-style runtime `@font-face`, so a custom font must be
 * registered with `expo-font` before it can be used. This hook:
 *   1. loads every entry in `typography.fonts` via `expo-font` (remote URL or
 *      bundled `require(...)`), then
 *   2. sets the resolved `fontFamily` as the default for all `<Text>` and
 *      `<TextInput>` rendered by the chat — mirroring how the web SDK sets a
 *      CSS variable. Individual components can still override per-style.
 *
 * `expo-font` is an optional peer dependency: if the host hasn't installed it,
 * the hook degrades gracefully (font simply isn't loaded) instead of throwing.
 *
 * No-op when `typography` is undefined — the system font is kept, so existing
 * integrations are unaffected.
 *
 * @returns `true` once fonts are ready (or when there's nothing to load), so
 *          callers can gate first paint to avoid a font "flash" if desired.
 */
export function useChatFonts(typography?: TypographyConfig): boolean {
  const [ready, setReady] = useState(!typography?.fonts?.length);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Apply the default family immediately so already-available fonts
      // (system, or host-loaded) take effect without waiting on a download.
      applyDefaultFont(typography);

      if (!typography?.fonts?.length) {
        setReady(true);
        return;
      }

      try {
        // Optional dependency — resolve lazily so apps that don't use custom
        // fonts don't need expo-font installed.
        const ExpoFont = await import('expo-font').catch(() => null);
        if (!ExpoFont) {
          if (!cancelled) setReady(true);
          return;
        }
        const map: Record<string, string | number> = {};
        for (const f of typography.fonts) map[f.family] = f.source as never;
        await ExpoFont.loadAsync(map);
        if (!cancelled) {
          applyDefaultFont(typography);
          setReady(true);
        }
      } catch {
        // Loading failed (e.g. bad URL) — keep the fallback font, don't block UI.
        if (!cancelled) setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    typography?.fontFamily,
    JSON.stringify(typography?.fonts ?? []),
    JSON.stringify(typography?.weightFamilies ?? {}),
  ]);

  return ready;
}

/**
 * The family currently applied as the chat-wide default. Read at render time
 * by the patched components below, so updating it (then triggering a re-render)
 * restyles the whole tree.
 */
let activeFamily: string | undefined;

/**
 * Install the default-font mechanism ONCE on RN's Text / TextInput.
 *
 * Why not `Text.defaultProps`? React 19 (shipped with RN 0.81) ignores
 * `defaultProps` on function components, and RN's `Text` is a `forwardRef`
 * function component — so the old trick silently no-ops. Instead we wrap each
 * component's `render` and inject `{ fontFamily }` as the *lowest-priority*
 * style, so any explicit per-component style still wins. This is independent
 * of the React version. We patch the shared module objects once; since every
 * chat component imports the same `Text`/`TextInput` from 'react-native', the
 * default applies everywhere.
 */
function ensurePatched(): void {
  const targets: any[] = [Text, TextInput];
  for (const Comp of targets) {
    if (!Comp || Comp.__ethoraFontPatched) continue;
    // forwardRef components expose a `render(props, ref)` function. Both RN
    // Text and TextInput are forwardRef in RN 0.73+. Wrap render and inject
    // the font as the lowest-priority style (explicit styles still win).
    if (typeof Comp.render === 'function') {
      const orig = Comp.render;
      Comp.render = function patchedRender(props: any, ref: any) {
        const el = orig.call(this, props, ref);
        if (!activeFamily || !el) return el;
        return React.cloneElement(el, {
          style: [{ fontFamily: activeFamily }, el.props?.style],
        });
      };
      Comp.__ethoraFontPatched = true;
    }
  }
}

/**
 * Set (or clear) the chat-wide default font family.
 */
function applyDefaultFont(typography?: TypographyConfig): void {
  activeFamily = typography?.fontFamily;
  if (activeFamily) ensurePatched();
}
