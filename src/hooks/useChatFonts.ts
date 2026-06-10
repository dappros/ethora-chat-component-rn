import { useEffect, useState } from 'react';
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

  applyDefaultFont(typography);

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


function wrapFactory(orig: any): any {
  if (typeof orig !== 'function') return orig;
  if (orig.__ethoraFontWrapped) return orig;
  const wrapped = function (this: any, type: any, props: any, ...rest: any[]) {
    if (
      activeFamily &&
      props &&
      (type === Text || type === TextInput)
    ) {
      props = { ...props, style: [{ fontFamily: activeFamily }, props.style] };
    }
    return orig.call(this, type, props, ...rest);
  };
  wrapped.__ethoraFontWrapped = true;
  return wrapped;
}

let factoriesPatched = false;

function ensurePatched(): void {
  if (factoriesPatched) return;

  let any = false;

  const patchMod = (mod: any): void => {
    if (!mod) return;
    for (const fn of ['jsx', 'jsxs', 'jsxDEV']) {
      if (typeof mod[fn] === 'function' && !mod[fn].__ethoraFontWrapped) {
        mod[fn] = wrapFactory(mod[fn]);
        any = true;
      }
    }
  };

  try {
    patchMod(require('react/jsx-runtime'));
  } catch {
    /* ignore */
  }
  try {
    patchMod(require('react/jsx-dev-runtime'));
  } catch {
    /* ignore */
  }

  try {
    const React = require('react');
    if (
      typeof React.createElement === 'function' &&
      !React.createElement.__ethoraFontWrapped
    ) {
      React.createElement = wrapFactory(React.createElement);
      any = true;
    }
  } catch {
    /* ignore */
  }

  if (any) factoriesPatched = true;
}

/**
 * Set (or clear) the chat-wide default font family.
 */
function applyDefaultFont(typography?: TypographyConfig): void {
  activeFamily = typography?.fontFamily;
  if (activeFamily) ensurePatched();
}
