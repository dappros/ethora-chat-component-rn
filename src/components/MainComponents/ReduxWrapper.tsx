/** @format */

import React, { useMemo } from "react";
import { Provider } from "react-redux";
import { store } from "../../roomStore";
import { ConfigUser, IConfig, MessageProps } from "../../types/types";
import { XmppProvider } from "../../context/xmppProvider.tsx";
import LoginWrapper from "./LoginWrapper.tsx";
import { ViewStyle } from "react-native";
import { ToastProvider } from "../../context/ToastContext.tsx";
import { CustomComponentsContextValue } from "../../types/models/customComponents.model";

interface ChatWrapperProps {
  token?: string;
  roomJID?: string;
  user?: ConfigUser;
  loginData?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  CustomInputComponent?: React.ComponentType<any>;
  CustomScrollableArea?: React.ComponentType<any>;
  CustomDaySeparator?: React.ComponentType<any>;
  CustomNewMessageLabel?: React.ComponentType<any>;
  config?: IConfig;
}

export const ReduxWrapper: React.FC<ChatWrapperProps> = React.memo(
  ({ ...props }) => {
    const memoizedConfig = useMemo(() => {
      return props.config;
    }, [props.config]);

    const memoizedProps = useMemo(
      () => ({
        CustomMessageComponent: props.CustomMessageComponent,
        CustomInputComponent: props.CustomInputComponent,
        CustomScrollableArea: props.CustomScrollableArea,
        CustomDaySeparator: props.CustomDaySeparator,
        CustomNewMessageLabel: props.CustomNewMessageLabel,
      }),
      [
        props.CustomMessageComponent,
        props.CustomInputComponent,
        props.CustomScrollableArea,
        props.CustomDaySeparator,
        props.CustomNewMessageLabel,
      ]
    );

    return (
      <React.StrictMode>
        <Provider store={store}>
          <ToastProvider>
            <LoginWrapper
              config={memoizedConfig}
              {...props}
              {...memoizedProps}
            />
          </ToastProvider>
        </Provider>
      </React.StrictMode>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.roomJID === nextProps.roomJID &&
      prevProps.config === nextProps.config &&
      prevProps.token === nextProps.token &&
      prevProps.user === nextProps.user &&
      prevProps.CustomMessageComponent === nextProps.CustomMessageComponent &&
      prevProps.CustomInputComponent === nextProps.CustomInputComponent &&
      prevProps.CustomScrollableArea === nextProps.CustomScrollableArea &&
      prevProps.CustomDaySeparator === nextProps.CustomDaySeparator &&
      prevProps.CustomNewMessageLabel === nextProps.CustomNewMessageLabel
    );
  }
);
