import { resolveTheme, type ThemeConfigInput } from '../theme/theme';

/** Day-separator pill colour; theme-aware (see getIconColor). */
export const getDateLabelColor = (config?: ThemeConfigInput | null) =>
  resolveTheme(config).dateLabel;
