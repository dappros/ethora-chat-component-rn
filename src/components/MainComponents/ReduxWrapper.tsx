import React, {useMemo} from 'react';
import {Provider} from 'react-redux';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {store} from '../../roomStore';
import {ConfigUser, IConfig, MessageProps} from '../../types/types';
import {XmppProvider} from '../../context/xmppProvider';
import {MessageNotificationProvider} from '../../context/MessageNotificationContext';
import {ToastProvider} from '../../context/ToastContext';
import LoginWrapper from './LoginWrapper';
import '../../helpers/storeConsole';
import {installPromiseRejectionTracker} from '../../utils/installPromiseRejectionTracker';
import {useChatFonts} from '../../hooks/useChatFonts';

// Mount-time, dev-only — wire a global unhandled-promise-rejection
// tracker so any future leak surfaces with a real stack trace in Metro
// logs (bug #4 follow-up). No-op in production.
installPromiseRejectionTracker();

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

    const tree = (
      <XmppProvider config={memoizedConfig} isVisible={props.isVisible}>
        <ToastProvider>
          <MessageNotificationProvider config={memoizedConfig}>
            <LoginWrapper config={memoizedConfig} {...props} />
          </MessageNotificationProvider>
        </ToastProvider>
      </XmppProvider>
    );

    return (
      <Provider store={store}>
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
