import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';
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

  // Apply synchronously on render (not just in the effect) so the factory
  // patch sees the active family/weights before the first child paints.
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
 * The family currently applied as the chat-wide default. Read at element-
 * creation time by the patched JSX factories below, so updating it (then
 * triggering a re-render) restyles the whole tree.
 */
let activeFamily: string | undefined;

/**
 * Per-weight families (regular/medium/semibold/bold). When set, the factory
 * patch maps a Text's effective `fontWeight` to the matching family so custom
 * fonts render intermediate weights correctly — RN can't synthesise 500/600
 * from a single font file (only fake-bold ~700), so each weight needs its own
 * loaded family. This is why a bare `fontWeight: '500'` looked like it did
 * nothing before: there was no medium family to switch to.
 */
let activeWeightFamilies: TypographyConfig['weightFamilies'] | undefined;

/**
 * Resolve a desired weight to a configured family variant. Returns undefined
 * when there's no variant for that tier (so we leave the default family /
 * weight untouched rather than guessing).
 */
function familyForWeight(weight: unknown): string | undefined {
  const wf = activeWeightFamilies;
  if (!wf || weight == null) {return undefined;}
  let w: number;
  if (typeof weight === 'number') {
    w = weight;
  } else if (weight === 'bold') {
    w = 700;
  } else if (weight === 'normal') {
    w = 400;
  } else {
    const n = parseInt(String(weight), 10);
    w = Number.isFinite(n) ? n : 400;
  }
  if (w >= 700) {return wf.bold;}
  if (w >= 600) {return wf.semibold;}
  if (w >= 500) {return wf.medium;}
  return wf.regular;
}

/**
 * Build the style array for a Text/TextInput element: the default family as the
 * lowest-priority layer (explicit per-component styles still win), and — when
 * per-weight families are configured — the variant family that matches the
 * element's effective `fontWeight` as a top layer (with the numeric weight
 * cleared so the OS doesn't also try to synthesise on top). An explicit
 * per-element `fontFamily` override is respected.
 */
function styleForElement(style: any): any {
  const base = [{ fontFamily: activeFamily }, style];
  if (!activeWeightFamilies) {return base;}
  const flat = (StyleSheet.flatten(style) || {}) as any;
  if (flat.fontFamily && flat.fontFamily !== activeFamily) {return base;}
  const fam = familyForWeight(flat.fontWeight);
  if (!fam) {return base;}
  return [{ fontFamily: activeFamily }, style, { fontFamily: fam, fontWeight: 'normal' }];
}

/**
 * Wrap a JSX factory (`jsx`/`jsxs`/`jsxDEV`/`createElement`) so every Text /
 * TextInput it creates gets the chat-wide font injected. We patch the factory
 * rather than `Text.render` because render-wrapping a `forwardRef` component is
 * fragile across React 19 / RN 0.81; intercepting element creation is version-
 * independent and catches styled-components' inner Text elements too.
 */
function wrapFactory(orig: any): any {
  if (typeof orig !== 'function') return orig;
  if (orig.__ethoraFontWrapped) return orig;
  const wrapped = function (this: any, type: any, props: any, ...rest: any[]) {
    if (activeFamily && props && (type === Text || type === TextInput)) {
      props = { ...props, style: styleForElement(props.style) };
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
 * Set (or clear) the chat-wide default font family + per-weight families.
 */
function applyDefaultFont(typography?: TypographyConfig): void {
  activeFamily = typography?.fontFamily;
  activeWeightFamilies = typography?.weightFamilies;
  if (activeFamily) ensurePatched();
}
