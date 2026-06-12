import type { TextStyle } from 'react-native';
import type { IConfig, TypographyConfig } from '../types/types';

type ElementKey = keyof NonNullable<TypographyConfig['elements']>;

/**
 * Per-element font override from `config.typography.elements`, as an RN
 * style object suitable for appending to a component's `style` (so it
 * wins over the built-in size/weight but touches nothing else).
 * Returns undefined when the element isn't configured — appending
 * undefined to a style array is a no-op.
 */
export const getElementFont = (
  config: IConfig | undefined,
  element: ElementKey
): TextStyle | undefined => {
  const override = config?.typography?.elements?.[element];
  if (!override) {return undefined;}
  const style: TextStyle = {};
  if (override.fontSize != null) {style.fontSize = override.fontSize;}
  if (override.fontWeight != null) {style.fontWeight = override.fontWeight;}
  return style.fontSize != null || style.fontWeight != null
    ? style
    : undefined;
};
