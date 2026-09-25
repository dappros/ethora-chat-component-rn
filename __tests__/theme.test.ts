import {
  DARK_THEME,
  LIGHT_THEME,
  resolveTheme,
  isDarkTheme,
} from '../src/theme/theme';
import { getIconColor } from '../src/helpers/getIconColor';
import { getChatBackgroundColor } from '../src/helpers/getChatBackground';

describe('resolveTheme', () => {
  it('returns the light palette by default', () => {
    const t = resolveTheme(undefined);
    expect(t.dark).toBe(false);
    expect(t.statusBarStyle).toBe('dark-content');
    expect(t.surface).toBe(LIGHT_THEME.surface);
    expect(t.primary).toBe('#0052CD');
    expect(isDarkTheme(undefined)).toBe(false);
  });

  it('applies config.colors / messageColor / backgroundChat in light mode', () => {
    const t = resolveTheme({
      colors: { primary: '#123456' },
      messageColor: { backgroundMessageUser: '#ABCDEF' },
      backgroundChat: { color: '#EEEEEE' },
    });
    expect(t.primary).toBe('#123456');
    // icon / senderName / dateLabel keep falling back to primary
    expect(t.icon).toBe('#123456');
    expect(t.senderName).toBe('#123456');
    expect(t.dateLabel).toBe('#123456');
    expect(t.messageBackgroundUser).toBe('#ABCDEF');
    expect(t.messageBackground).toBe(LIGHT_THEME.messageBackground);
    expect(t.chatBackground).toBe('#EEEEEE');
  });

  it('uses the dark defaults when dark is on and no darkColors given', () => {
    const t = resolveTheme({ dark: true, colors: { primary: '#123456' } });
    expect(t.dark).toBe(true);
    expect(t.statusBarStyle).toBe('light-content');
    expect(t.surface).toBe(DARK_THEME.surface);
    // light-only knobs are ignored in dark mode
    expect(t.primary).toBe(DARK_THEME.primary);
    expect(isDarkTheme({ dark: true })).toBe(true);
  });

  it('merges darkColors over the dark defaults', () => {
    const t = resolveTheme({
      dark: true,
      darkColors: { primary: '#7C3AED', surface: '#111111', icon: undefined },
    });
    expect(t.primary).toBe('#7C3AED');
    expect(t.surface).toBe('#111111');
    // accents fall back to the overridden primary
    expect(t.icon).toBe('#7C3AED');
    expect(t.senderName).toBe('#7C3AED');
    // untouched keys keep their dark default
    expect(t.text).toBe(DARK_THEME.text);
    expect(t.listBackground).toBe(DARK_THEME.listBackground);
  });

  it('keeps existing colour helpers in sync with the theme', () => {
    expect(getIconColor({ colors: { icon: '#ABC' } })).toBe('#ABC');
    expect(getIconColor({ dark: true })).toBe(DARK_THEME.icon);
    expect(getIconColor({ dark: true, darkColors: { icon: '#FFF' } })).toBe('#FFF');
    expect(getChatBackgroundColor({ dark: true } as any)).toBe(
      DARK_THEME.chatBackground
    );
    expect(getChatBackgroundColor(undefined)).toBe(LIGHT_THEME.chatBackground);
  });
});
