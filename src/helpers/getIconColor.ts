import { resolveTheme, type ThemeConfigInput } from '../theme/theme';

/** Chrome icon tint (attach, mic/send, burger, back). Theme-aware: in dark
 * mode it comes from `darkColors.icon` → `darkColors.primary` → default. */
export const getIconColor = (config?: ThemeConfigInput | null) =>
  resolveTheme(config).icon;
