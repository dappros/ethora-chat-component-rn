import React, {useMemo} from 'react';
import {Provider} from 'react-redux';
import {store} from '../../roomStore';
import {ConfigUser, IConfig, MessageProps} from '../../types/types';
import {XmppProvider} from '../../context/xmppProvider.tsx';
import {MessageNotificationProvider} from '../../context/MessageNotificationContext.tsx';
import {ToastProvider} from '../../context/ToastContext.tsx';
import LoginWrapper from './LoginWrapper.tsx';
// Side-effect import: attaches globalThis.useStoreConsole when enabled.
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
        <XmppProvider config={memoizedConfig}>
          <ToastProvider>
            <MessageNotificationProvider config={memoizedConfig}>
              <LoginWrapper config={memoizedConfig} {...props} />
            </MessageNotificationProvider>
          </ToastProvider>
        </XmppProvider>
      </Provider>
    );
  },
);
