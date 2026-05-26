import React, {useMemo} from 'react';
import {Provider} from 'react-redux';
import {KeyboardProvider} from 'react-native-keyboard-controller';
import {store} from '../../roomStore';
import {ConfigUser, IConfig, MessageProps} from '../../types/types';
import {XmppProvider} from '../../context/xmppProvider';
import {MessageNotificationProvider} from '../../context/MessageNotificationContext';
import {ToastProvider} from '../../context/ToastContext';
import LoginWrapper from './LoginWrapper';
import '../../helpers/storeConsole';

interface ChatWrapperProps {
  token?: string;
  roomJID?: string;
  user?: ConfigUser;
  loginData?: {email: string; password: string};
  MainComponentStyles?: React.CSSProperties;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
}

export const ReduxWrapper: React.FC<ChatWrapperProps> = React.memo(
  ({...props}) => {
    const memoizedConfig = useMemo(() => {
      return props.config;
    }, [props.config]);

    return (
      <Provider store={store}>
        <KeyboardProvider>
          <XmppProvider config={memoizedConfig}>
            <ToastProvider>
              <MessageNotificationProvider config={memoizedConfig}>
                <LoginWrapper config={memoizedConfig} {...props} />
              </MessageNotificationProvider>
            </ToastProvider>
          </XmppProvider>
        </KeyboardProvider>
      </Provider>
    );
  },
);
