import type { TextStyle } from 'react-native';
import type { ChatTextStyle } from '../types/types';

/**
 * Turn a `ChatTextStyle` config (fontSize / fontWeight) into a partial RN
 * `TextStyle` that can be spread on top of a base style. Only sets fields the
 * consumer actually provided, so it never clobbers a component default with
 * `undefined`. Pair with a base style: `style={[styles.title, chatTextStyle(cfg)]}`.
 *
 * Note: with a custom font, `fontWeight` only renders visibly when
 * `typography.weightFamilies` is configured — the global font patch
 * (useChatFonts) maps the weight to the matching family variant.
 */
export const chatTextStyle = (cfg?: ChatTextStyle): TextStyle => {
  const s: TextStyle = {};
  if (cfg?.fontSize != null) {s.fontSize = cfg.fontSize;}
  if (cfg?.fontWeight != null) {s.fontWeight = cfg.fontWeight;}
  return s;
};
