/** @format */

/**
 * Chat theme.
 *
 * One palette object drives every surface, text and accent colour in the
 * component. The light palette is the historical look (all the previously
 * hard-coded values live here now). The dark palette is enabled by
 * `config.dark = true`; any of its entries can be overridden through
 * `config.darkColors`, and anything not overridden falls back to the
 * DARK_THEME default.
 *
 * Resolution order:
 *   light: LIGHT_THEME ← config.colors (primary/secondary/icon…) ← messageColor ← backgroundChat.color
 *   dark:  DARK_THEME  ← config.darkColors
 *
 * In dark mode the light-only knobs (`colors`, `messageColor`,
 * `backgroundChat.color`) are deliberately NOT applied: they were tuned
 * against white surfaces and would produce unreadable bubbles on a dark
 * ground. Hosts that want brand colours in the dark theme pass them via
 * `darkColors`. `colors.avatar` is the one exception — it is a brand
 * colour that reads fine on either ground — see getAvatarColor.
 */

export interface ChatThemeColors {
  /** Brand accent: buttons, active states, links, sender names. */
  primary: string;
  /** Secondary accent (text on primary, secondary buttons). */
  secondary: string;
  /** Tint for chrome icons (attach, send, burger, back). */
  icon: string;
  /** Sender name above incoming bubbles. */
  senderName: string;
  /** Day-separator pill text; its background is a tint of it. */
  dateLabel: string;

  /** Ground of the room list screen. */
  listBackground: string;
  /** Ground of the conversation (behind the message list). */
  chatBackground: string;
  /** Cards floating over the ground: headers, composer, drawer, modals, sheets. */
  surface: string;
  /** Fields and chips sitting on a surface: text input, search box, menu rows. */
  surfaceSecondary: string;
  /** Pressed / selected row highlight. */
  surfaceHighlight: string;

  /** Primary text. */
  text: string;
  /** Secondary text: previews, timestamps, subtitles. */
  textSecondary: string;
  /** Muted text: placeholders, hints, disabled labels. */
  textMuted: string;
  /** Text drawn on top of `primary`. */
  textOnPrimary: string;

  /** Hairline borders around fields and cards. */
  border: string;
  /** Row separators in lists. */
  divider: string;
  /** Shadow colour under floating cards. */
  shadow: string;
  /** Scrim behind modals and sheets. */
  overlay: string;

  /** Incoming message bubble. */
  messageBackground: string;
  /** Outgoing (own) message bubble. */
  messageBackgroundUser: string;
  /** Incoming bubble text. */
  messageText: string;
  /** Outgoing bubble text. */
  messageTextUser: string;
  /** System / service messages background. */
  systemMessageBackground: string;

  /** Unread badge + destructive accents. */
  danger: string;
  /** Success accents (online dot, sent tick). */
  success: string;
}

/** Everything in the palette can be overridden per entry. */
export type ChatThemeOverrides = Partial<ChatThemeColors>;

export interface ChatTheme extends ChatThemeColors {
  /** `true` when the dark palette is active. */
  dark: boolean;
  /** StatusBar style that reads on `surface`. */
  statusBarStyle: 'light-content' | 'dark-content';
}

const DEFAULT_PRIMARY = '#0052CD';

export const LIGHT_THEME: ChatThemeColors = {
  primary: DEFAULT_PRIMARY,
  secondary: '#141414',
  icon: DEFAULT_PRIMARY,
  senderName: DEFAULT_PRIMARY,
  dateLabel: DEFAULT_PRIMARY,

  listBackground: '#E8EDF2',
  chatBackground: '#F3F6FC',
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F7F9',
  surfaceHighlight: '#0052CD0D',

  text: '#141414',
  textSecondary: '#8C8C8C',
  textMuted: '#999999',
  textOnPrimary: '#FFFFFF',

  border: '#E5E7EB',
  divider: '#C6CFDA',
  shadow: '#101828',
  overlay: 'rgba(0, 0, 0, 0.3)',

  messageBackground: '#FFFFFF',
  messageBackgroundUser: '#D1E7FF',
  messageText: '#333333',
  messageTextUser: '#333333',
  systemMessageBackground: '#F5F5F5',

  danger: '#E53935',
  success: '#22C55E',
};

export const DARK_THEME: ChatThemeColors = {
  primary: '#4C8DFF',
  secondary: '#F2F4F7',
  icon: '#4C8DFF',
  senderName: '#7FB0FF',
  dateLabel: '#7FB0FF',

  listBackground: '#0F1216',
  chatBackground: '#141A21',
  surface: '#1C2430',
  surfaceSecondary: '#26303D',
  surfaceHighlight: '#4C8DFF26',

  text: '#F2F4F7',
  textSecondary: '#A0A8B3',
  textMuted: '#7A8391',
  textOnPrimary: '#FFFFFF',

  border: '#2F3A47',
  divider: '#2F3A47',
  shadow: '#000000',
  overlay: 'rgba(0, 0, 0, 0.6)',

  messageBackground: '#1F2833',
  messageBackgroundUser: '#1E3A5F',
  messageText: '#F2F4F7',
  messageTextUser: '#F2F4F7',
  systemMessageBackground: '#26303D',

  danger: '#F87171',
  success: '#4ADE80',
};

/** The subset of IConfig the theme depends on (kept structural so the
 * helpers can be called with partial configs in tests). */
export interface ThemeConfigInput {
  dark?: boolean;
  darkColors?: ChatThemeOverrides;
  colors?: {
    primary?: string;
    secondary?: string;
    icon?: string;
    senderName?: string;
    dateLabel?: string;
  };
  messageColor?: {
    backgroundMessage?: string;
    backgroundMessageUser?: string;
    colorUser?: string;
    color?: string;
  };
  backgroundChat?: { color?: string };
}

export const isDarkTheme = (config?: ThemeConfigInput | null): boolean =>
  !!config?.dark;

const pick = <T>(...values: (T | undefined | null | '')[]): T | undefined =>
  values.find((v) => v !== undefined && v !== null && v !== '') as
    | T
    | undefined;

const stripUndefined = (o: ChatThemeOverrides): ChatThemeOverrides =>
  Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ) as ChatThemeOverrides;

/**
 * Build the effective palette for a config. Pure; memoize at the call
 * site (useTheme does).
 */
export const resolveTheme = (config?: ThemeConfigInput | null): ChatTheme => {
  if (isDarkTheme(config)) {
    const overrides = stripUndefined(config?.darkColors ?? {});
    const primary = pick(overrides.primary, DARK_THEME.primary)!;
    return {
      ...DARK_THEME,
      // Accents that historically fell back to `primary` keep doing so
      // when only `primary` is overridden.
      icon: pick(overrides.icon, overrides.primary, DARK_THEME.icon)!,
      senderName: pick(overrides.senderName, overrides.primary, DARK_THEME.senderName)!,
      dateLabel: pick(overrides.dateLabel, overrides.primary, DARK_THEME.dateLabel)!,
      ...overrides,
      primary,
      dark: true,
      statusBarStyle: 'light-content',
    };
  }

  const c = config?.colors;
  const primary = pick(c?.primary, LIGHT_THEME.primary)!;
  return {
    ...LIGHT_THEME,
    primary,
    secondary: pick(c?.secondary, LIGHT_THEME.secondary)!,
    icon: pick(c?.icon, c?.primary, LIGHT_THEME.icon)!,
    senderName: pick(c?.senderName, c?.primary, LIGHT_THEME.senderName)!,
    dateLabel: pick(c?.dateLabel, c?.primary, LIGHT_THEME.dateLabel)!,
    chatBackground: pick(config?.backgroundChat?.color, LIGHT_THEME.chatBackground)!,
    messageBackground: pick(
      config?.messageColor?.backgroundMessage,
      LIGHT_THEME.messageBackground
    )!,
    messageBackgroundUser: pick(
      config?.messageColor?.backgroundMessageUser,
      LIGHT_THEME.messageBackgroundUser
    )!,
    messageText: pick(config?.messageColor?.color, LIGHT_THEME.messageText)!,
    messageTextUser: pick(
      config?.messageColor?.colorUser,
      LIGHT_THEME.messageTextUser
    )!,
    dark: false,
    statusBarStyle: 'dark-content',
  };
};
