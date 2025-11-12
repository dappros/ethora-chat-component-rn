import React, { useMemo } from "react";
import { Provider } from "react-redux";
import { store } from "../../roomStore";
import { ConfigUser, IConfig, MessageProps } from "../../types/types";
import { XmppProvider } from "../../context/xmppProvider.tsx";
import LoginWrapper from "./LoginWrapper.tsx";
import { ViewStyle } from "react-native";
import { ToastProvider } from "../../context/ToastContext.tsx";

interface ChatWrapperProps {
  token?: string;
  roomJID?: string;
  user?: ConfigUser;
  loginData?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
}

export const ReduxWrapper: React.FC<ChatWrapperProps> = React.memo(
  ({ ...props }) => {
    const memoizedConfig = useMemo(() => {
      return props.config;
    }, [props.config]);

    return (
      <React.StrictMode>
        <XmppProvider>
          <Provider store={store}>
            <ToastProvider>
              <LoginWrapper config={memoizedConfig} {...props} />
            </ToastProvider>
          </Provider>
        </XmppProvider>
      </React.StrictMode>
    );
  }
);
