import React, {useEffect, useMemo, useRef} from 'react';
import {useColorScheme} from 'react-native';
import {Provider, useDispatch, useSelector} from 'react-redux';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {ThemeProvider} from 'styled-components/native';
import {applyThemePreference, resolveTheme} from '../../theme/theme';
import {store} from '../../roomStore';
import type {RootState} from '../../roomStore';
import {
  setConfig,
  setPushEnabled,
  setThemePreference,
} from '../../roomStore/chatSettingsSlice';
import {loadPreferences} from '../../helpers/preferencesStorage';
import {ConfigUser, IConfig, MessageProps} from '../../types/types';
import {XmppProvider} from '../../context/xmppProvider';
import {MessageNotificationProvider} from '../../context/MessageNotificationContext';
import {ToastProvider} from '../../context/ToastContext';
import LoginWrapper from './LoginWrapper';
import '../../helpers/storeConsole';
import {installPromiseRejectionTracker} from '../../utils/installPromiseRejectionTracker';
import {useChatFonts} from '../../hooks/useChatFonts';
import {installPushTokenHook} from '../../services/pushRegistration';

// Mount-time, dev-only — wire a global unhandled-promise-rejection
// tracker so any future leak surfaces with a real stack trace in Metro
// logs (bug #4 follow-up). No-op in production.
installPromiseRejectionTracker();

// Arms the push-token watcher once for the package: it runs
// `config.pushNotifications.getPushTokens` for every login and flushes
// tokens handed over through `registerPushToken` before sign-in. Cheap
// (one store subscription), no-op for hosts that never use push.
installPushTokenHook();

interface ChatWrapperProps {
  token?: string;
  roomJID?: string;
  user?: ConfigUser;
  loginData?: {email: string; password: string};
  MainComponentStyles?: React.CSSProperties;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
  isVisible?: boolean;
}

// Mirrors the web SDK's ConfigEnabler (ReduxWrapper.tsx): keeps redux's
// copy of the config in step with the prop. Without it setConfig is only
// dispatched during XMPP init, so a host changing config mid-session (the
// testbed's Setup toggles, a host flipping translates.readerLocale) kept
// serving a STALE config to everything that reads it from the store —
// which is why picking a reader language changed nothing.
const ConfigEnabler: React.FC<{config?: IConfig}> = ({config}) => {
  const dispatch = useDispatch();
  React.useEffect(() => {
    if (!config) {return;}
    dispatch(setConfig(config));
  }, [config, dispatch]);
  return null;
};

const ChatThemeProvider: React.FC<{config?: IConfig; children: React.ReactNode}> = ({
  config,
  children,
}) => {
  const dispatch = useDispatch();
  const storeConfig = useSelector((s: RootState) => s.chatSettingStore.config);
  const preference = useSelector(
    (s: RootState) => s.chatSettingStore.themePreference,
  );
  const systemDark = useColorScheme() === 'dark';
  const effective = applyThemePreference(storeConfig ?? config, preference);
  const theme = useMemo(
    () => resolveTheme(effective, systemDark),
    [effective, systemDark],
  );

  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) {return;}
    hydrated.current = true;
    loadPreferences().then((prefs) => {
      if (prefs.theme) {dispatch(setThemePreference(prefs.theme));}
      if (typeof prefs.pushEnabled === 'boolean') {
        dispatch(setPushEnabled(prefs.pushEnabled));
      }
    });
  }, [dispatch]);

  const onThemeChange = config?.eventHandlers?.onThemeChange;
  useEffect(() => {
    if (preference && onThemeChange) {onThemeChange(preference, theme.dark);}
  }, [preference, theme.dark, onThemeChange]);

  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
};

export const ReduxWrapper: React.FC<ChatWrapperProps> = React.memo(
  ({...props}) => {
    const memoizedConfig = useMemo(() => {
      return props.config;
    }, [props.config]);

    // Load + apply the host-provided font (no-op when typography is unset).
    useChatFonts(memoizedConfig?.typography);

    // Host apps that own their keyboard handling (their own
    // KeyboardProvider + KeyboardAvoidingView around <Chat>) set
    // `disableKeyboardAvoidingView` — drop the built-in KeyboardProvider
    // here too so there aren't two nested providers (the second is part of
    // the Android keyboard flicker in bug #6; ChatRoom drops the matching
    // KeyboardAvoidingView under the same flag).
    const ownKeyboardHandling = !memoizedConfig?.disableKeyboardAvoidingView;

    // Light/dark palette (config.dark + config.darkColors + the Settings
    // choice). Styled components read it via `({ theme }) => theme.surface`;
    // plain RN styles via the `useTheme()` hook.
    const tree = (
      <ChatThemeProvider config={memoizedConfig}>
        <XmppProvider config={memoizedConfig} isVisible={props.isVisible}>
          <ToastProvider>
            <MessageNotificationProvider config={memoizedConfig}>
              <LoginWrapper config={memoizedConfig} {...props} />
            </MessageNotificationProvider>
          </ToastProvider>
        </XmppProvider>
      </ChatThemeProvider>
    );

    return (
      <Provider store={store}>
        <ConfigEnabler config={memoizedConfig} />
        <SafeAreaProvider>
          {ownKeyboardHandling ? (
            <KeyboardProvider>{tree}</KeyboardProvider>
          ) : (
            tree
          )}
        </SafeAreaProvider>
      </Provider>
    );
  },
);
