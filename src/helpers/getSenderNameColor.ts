import { resolveTheme, type ThemeConfigInput } from '../theme/theme';

/** Sender name colour above incoming bubbles; theme-aware (see getIconColor). */
export const getSenderNameColor = (config?: ThemeConfigInput | null) =>
  resolveTheme(config).senderName;
