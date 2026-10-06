/**
 * Settings the host can turn on: the user's two languages, and changing the
 * password.
 *
 * Languages live on the profile (`PUT /v1/users`, one field per request)
 * and on the device; the interface follows the app language at once, and
 * the chat language is what the server translates messages into. The
 * password goes to `PUT /v2/users/me/password`, with the backend's reason
 * shown when it refuses.
 */

const mockHttp = { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() };
jest.mock('../src/networking/apiClient', () => ({
  __esModule: true,
  // Looked up at call time: the mock object above is not initialised yet
  // when this factory runs for the first import.
  default: {
    get: (...a: any[]) => mockHttp.get(...a),
    put: (...a: any[]) => mockHttp.put(...a),
    post: (...a: any[]) => mockHttp.post(...a),
    delete: (...a: any[]) => mockHttp.delete(...a),
  },
  getCurrentBaseURL: () => '',
  normalizeApiPath: (path?: string) => path,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const mockToast = jest.fn();
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: mockToast }),
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { store } from '../src/roomStore';
import {
  setConfig,
  setLangSource,
  setUiLocale,
  setUser,
} from '../src/roomStore/chatSettingsSlice';
import {
  applyProfileLanguages,
  canonicalLocale,
  chatLanguageChoices,
  languageLabel,
  setAppLanguage,
  setChatLanguage,
} from '../src/services/languageSettings';
import { loadPreferences } from '../src/helpers/preferencesStorage';
import LanguageCard from '../src/components/Modals/UserSettingsModal/LanguageCard';
import ChangePasswordModal from '../src/components/Modals/SettingsModals/ChangePassword/ChangePasswordModal';
import { useT } from '../src/i18n/useT';
import { Text } from 'react-native';

const render = async (node: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{node}</Provider>);
  });
  return tree!;
};
const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
const configure = async (config: any) => {
  await act(async () => {
    store.dispatch(setConfig(config));
    store.dispatch(setUiLocale(undefined));
    store.dispatch(setLangSource(undefined));
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockHttp.put.mockResolvedValue({ data: { user: { _id: 'u1', appLanguage: 'fr-CA' } } });
  await act(async () => {
    store.dispatch(setUser({ _id: 'u1', xmppUsername: 'me', token: 't' } as any));
  });
});

describe('language tags', () => {
  it('are canonicalised and labelled in their own language', () => {
    expect(canonicalLocale('en-ca')).toBe('en-CA');
    expect(canonicalLocale('FR_ca')).toBe('fr-CA');
    expect(canonicalLocale('pt')).toBe('pt');
    expect(canonicalLocale('')).toBeUndefined();
    expect(canonicalLocale('not a tag')).toBeUndefined();
    expect(languageLabel('fr-CA')).toBe('Français');
    expect(languageLabel('pt-BR')).toBe('Português');
    expect(languageLabel('xx')).toBe('xx');
  });

  it('come from the host when given, else from the built-in list', () => {
    expect(chatLanguageChoices({} as any).map((c) => c.id)).toEqual(['en-CA', 'es-US', 'fr-CA']);
    expect(
      chatLanguageChoices({ settings: { languages: { enabled: true, chatLanguages: ['de', 'uk-UA', 'junk!'] } } } as any)
    ).toEqual([
      { id: 'de', name: 'Deutsch' },
      { id: 'uk-UA', name: 'Українська' },
    ]);
  });
});

describe('choosing a language', () => {
  it('switches the interface at once, keeps it on the device and writes it to the profile', async () => {
    await configure({ settings: { languages: { enabled: true } } });
    const Caption = () => <Text>{useT()('settings.password.title')}</Text>;
    const tree = await render(<Caption />);
    expect(text(tree)).toContain('Change password');

    await act(async () => {
      await setAppLanguage('fr-CA');
    });
    expect(text(tree)).toContain('Changer le mot de passe');
    expect(mockHttp.put).toHaveBeenCalledWith('/v1/users', { appLanguage: 'fr-CA' });
    expect((await loadPreferences()).uiLocale).toBe('fr-CA');
    // The profile in the store carries the choice too - and only the choice.
    expect(store.getState().chatSettingStore.user.appLanguage).toBe('fr-CA');
    expect(store.getState().chatSettingStore.user.token).toBe('t');
    await act(async () => tree.unmount());
  });

  it('writes the chat language on its own, never the other field with it', async () => {
    await configure({ settings: { languages: { enabled: true } } });
    await setChatLanguage('es-US');
    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(mockHttp.put).toHaveBeenCalledWith('/v1/users', { chatLanguage: 'es-US' });
    expect(store.getState().chatSettingStore.langSource).toBe('es-US');
    expect((await loadPreferences()).chatLanguage).toBe('es-US');
  });

  it('keeps the choice when the profile write fails, and writes nothing when the host did not turn this on', async () => {
    await configure({ settings: { languages: { enabled: true } } });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockHttp.put.mockRejectedValueOnce(new Error('offline'));
    expect(await setAppLanguage('es-US')).toBe(false);
    warn.mockRestore();
    expect(store.getState().chatSettingStore.uiLocale).toBe('es-US');

    await configure({});
    await setAppLanguage('fr-CA');
    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(store.getState().chatSettingStore.uiLocale).toBe('fr-CA');
  });

  it("the user's own pick wins over the host's default locale", async () => {
    await configure({ i18n: { locale: 'es-US' }, settings: { languages: { enabled: true } } });
    const Caption = () => <Text>{useT()('settings.password.title')}</Text>;
    const tree = await render(<Caption />);
    expect(text(tree)).toContain('Cambiar contraseña');
    await act(async () => {
      await setAppLanguage('en-CA');
    });
    expect(text(tree)).toContain('Change password');
    await act(async () => tree.unmount());
  });
});

describe('the profile at session start', () => {
  it('sets both languages, the chat one following the app one when unset', async () => {
    await configure({ settings: { languages: { enabled: true } } });
    applyProfileLanguages({ appLanguage: 'fr-ca', chatLanguage: null }, store.getState().chatSettingStore.config);
    expect(store.getState().chatSettingStore.uiLocale).toBe('fr-CA');
    expect(store.getState().chatSettingStore.langSource).toBe('fr-CA');
    // Applied, not echoed back.
    expect(mockHttp.put).not.toHaveBeenCalled();

    applyProfileLanguages({ appLanguage: 'en-CA', chatLanguage: 'es-US' }, store.getState().chatSettingStore.config);
    expect(store.getState().chatSettingStore.uiLocale).toBe('en-CA');
    expect(store.getState().chatSettingStore.langSource).toBe('es-US');
  });

  it('does nothing while the host has not turned languages on, or for a profile that never chose', async () => {
    await configure({});
    applyProfileLanguages({ appLanguage: 'fr-CA', chatLanguage: 'fr-CA' }, {} as any);
    expect(store.getState().chatSettingStore.uiLocale).toBeUndefined();

    await configure({ settings: { languages: { enabled: true } } });
    await act(async () => {
      store.dispatch(setUiLocale('es-US'));
    });
    applyProfileLanguages({ appLanguage: null, chatLanguage: null }, store.getState().chatSettingStore.config);
    expect(store.getState().chatSettingStore.uiLocale).toBe('es-US');
  });
});

describe('the language card', () => {
  it('marks the current choices and applies a tap', async () => {
    await configure({ settings: { languages: { enabled: true } } });
    const tree = await render(<LanguageCard />);
    const selectedOf = (kind: string) =>
      tree.root
        .findAll(
          (n) =>
            typeof n.props?.testID === 'string' &&
            n.props.testID.startsWith(`settings-language-${kind}-`) &&
            n.props.accessibilityState &&
            typeof n.props.onPress === 'function'
        )
        .filter((n) => n.props.accessibilityState.selected)
        .map((n) => n.props.testID)
        // The touchable and the view it renders both carry the id.
        .filter((id, index, all) => all.indexOf(id) === index);
    // Nothing chosen yet: no app language marked; the chat language follows it.
    expect(selectedOf('app')).toEqual([]);

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'settings-language-app-fr-CA' && n.props.onPress).props.onPress();
    });
    await settle();
    expect(selectedOf('app')).toEqual(['settings-language-app-fr-CA']);
    expect(selectedOf('chat')).toEqual(['settings-language-chat-fr-CA']);
    expect(text(tree)).toContain('Langue du chat');

    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'settings-language-chat-es-US' && n.props.onPress).props.onPress();
    });
    await settle();
    expect(selectedOf('chat')).toEqual(['settings-language-chat-es-US']);
    expect(mockHttp.put.mock.calls.map((c) => c[1])).toEqual([{ appLanguage: 'fr-CA' }, { chatLanguage: 'es-US' }]);
    await act(async () => tree.unmount());
  });
});

describe('changing the password', () => {
  const fill = async (tree: renderer.ReactTestRenderer, id: string, value: string) => {
    await act(async () => {
      tree.root.find((n) => n.props?.testID === id && n.props.onChangeText).props.onChangeText(value);
    });
  };
  const submit = (tree: renderer.ReactTestRenderer) =>
    tree.root.find((n) => n.props?.testID === 'password-submit' && n.props.onPress);

  beforeEach(async () => {
    await configure({ settings: { changePassword: true } });
    await act(async () => {
      store.dispatch(setUser({ _id: 'u1', xmppUsername: 'me', token: 't' } as any));
    });
  });

  it('sends nothing until the form is complete and consistent', async () => {
    const close = jest.fn();
    const tree = await render(<ChangePasswordModal handleCloseModal={close} />);
    expect(submit(tree).props.disabled).toBe(true);

    await fill(tree, 'password-current', '12345678');
    await fill(tree, 'password-new', '1234');
    expect(text(tree)).toContain('At least 8 characters');
    await fill(tree, 'password-new', '12345678');
    expect(text(tree)).toContain('Must differ from the current password');
    await fill(tree, 'password-new', '123456789');
    await fill(tree, 'password-again', '12345678x');
    expect(text(tree)).toContain('The passwords do not match');
    expect(submit(tree).props.disabled).toBe(true);
    expect(mockHttp.put).not.toHaveBeenCalled();

    await fill(tree, 'password-again', '123456789');
    expect(submit(tree).props.disabled).toBe(false);
    await act(async () => {
      submit(tree).props.onPress();
    });
    expect(mockHttp.put).toHaveBeenCalledWith('/v2/users/me/password', {
      currentPassword: '12345678',
      newPassword: '123456789',
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
    expect(close).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it("shows the backend's reason when it refuses, and stays open", async () => {
    const close = jest.fn();
    const tree = await render(<ChangePasswordModal handleCloseModal={close} />);
    await fill(tree, 'password-current', 'wrong-one');
    await fill(tree, 'password-new', 'new-password-1');
    await fill(tree, 'password-again', 'new-password-1');

    mockHttp.put.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Current password is invalid' } } });
    await act(async () => {
      submit(tree).props.onPress();
    });
    expect(text(tree)).toContain('Current password is invalid');
    expect(close).not.toHaveBeenCalled();

    // No reason given: a generic one, by status.
    mockHttp.put.mockRejectedValueOnce({ response: { status: 401, data: {} } });
    await act(async () => {
      submit(tree).props.onPress();
    });
    expect(text(tree)).toContain('The current password is not right');

    mockHttp.put.mockRejectedValueOnce(new Error('network'));
    await act(async () => {
      submit(tree).props.onPress();
    });
    expect(text(tree)).toContain('The password could not be changed');
    await act(async () => tree.unmount());
  });

  it('is in the app language, like the rest of the interface', async () => {
    await act(async () => {
      store.dispatch(setUiLocale('es-US'));
    });
    const tree = await render(<ChangePasswordModal handleCloseModal={jest.fn()} />);
    const shown = text(tree);
    expect(shown).toContain('Cambiar contraseña');
    expect(shown).toContain('Contraseña actual');
    expect(shown).toContain('Nueva contraseña');
    expect(shown).not.toContain('Current password');
    await act(async () => tree.unmount());
  });
});
