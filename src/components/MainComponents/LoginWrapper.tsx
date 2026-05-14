/** @format */

import React, { useCallback, useEffect, useState } from "react";
import { IConfig, MessageProps, User } from "../../types/types";
import { ChatWrapper } from "./ChatWrapper";
import { RootState } from "../../roomStore";
import { useDispatch, useSelector } from "react-redux";
import { logout, setConfig, setUser } from "../../roomStore/chatSettingsSlice";
import {
  loginEmail,
  loginViaJwt,
} from "../../networking/api-requests/auth.api";
import { OrDelimiter, StyledLoaderWrapper } from "../styled/StyledComponents";
import { Text, View, ViewStyle } from "react-native";
import Button from "../styled/Button";
import LoginForm from "../AuthForms/Login";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { localStorageConstants } from "../../helpers/constants/LOCAL_STORAGE";
import { setLogoutState } from "../../roomStore/roomsSlice";
import { setBaseURL } from "../../networking/apiClient";
import Loader from "../styled/Loader";
import { usePushNotifications } from "../../hooks/usePushNotifications";

interface LoginWrapperProps {
  user?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  CustomInputComponent?: React.ComponentType<any>;
  CustomScrollableArea?: React.ComponentType<any>;
  CustomDaySeparator?: React.ComponentType<any>;
  CustomNewMessageLabel?: React.ComponentType<any>;
  config?: IConfig;
  roomJID?: string;
}

const LoginWrapper: React.FC<LoginWrapperProps> = ({ ...props }) => {
  const [showModal, setShowModal] = useState(false);
  const { config, MainComponentStyles } = props;

  const { user } = useSelector((state: RootState) => state.chatSettingStore);

  usePushNotifications();

  const loginUserFunction = useCallback(async () => {
    try {
      const authData = await loginEmail(
        props?.user?.email || "yukiraze9@gmail.com",
        props?.user?.password || "Qwerty123"
      );

      return {
        ...authData.data.user,
        token: authData.data.token,
        refreshToken: authData.data.refreshToken,
      };
    } catch (error) {
      console.error("Login failed:", error);
      return null;
    }
  }, []);

  const dispatch = useDispatch();

  const localStorage = useLocalStorage<User>("@ethora/chat-component-user");

  useEffect(() => {
    if (config?.baseUrl) {
      setBaseURL(config?.baseUrl, config?.customAppToken);
    }
    if (config?.userLogin?.enabled && config?.userLogin?.user) {
      dispatch(setUser(config.userLogin.user));
      return;
    }

    const checkStoredUser = async () => {
      const storedUser = (await localStorage.get()) as User | null;
      if (storedUser) {
        dispatch(setUser(storedUser));
      }
    };
    checkStoredUser();

    if (config?.jwtLogin?.enabled) {
      const jwtLogin = async () => {
        try {
          if (!config?.jwtLogin?.token) {
            console.log(" No token provided");
            return;
          }

          console.log(" Starting JWT authentication...");
          const loginData = await loginViaJwt(config.jwtLogin.token);

          if (loginData) {
            console.log(" Successfully authenticated");

            // Store user data in localStorage for persistence
            await localStorage.set(loginData);

            // Dispatch to Redux store
            dispatch(setUser(loginData));
          } else {
            console.error("No user data returned from API");
            setShowModal(true);
          }
        } catch (error: any) {
          console.error("Error during authentication", {
            error: error?.message || error,
            stack: error?.stack,
            response: error?.response?.data,
            status: error?.response?.status,
          });
          setShowModal(true);
        }
      };
      jwtLogin();
    }

    //if no login config - default user login

    if (
      !config?.googleLogin &&
      !config?.defaultLogin &&
      !config?.jwtLogin &&
      !config?.userLogin &&
      user.xmppUsername === ""
    ) {
      const defaultLogin = async () => {
        try {
          const loginData = await loginUserFunction();
          if (loginData) {
            dispatch(setUser(loginData));
          }
        } catch (error) {
          console.log("error with default login", error);
          setShowModal(true);
        }
      };
      defaultLogin();
    }
    //if google - show login.tsx and process user there (there will be dispatch, set user)
    //if only ethora - show login with only ethora
    return () => {
      //clear
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      {showModal ? (
        <View
          style={{
            ...MainComponentStyles,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            flexDirection: "column",
            padding: 20,
            gap: 8,
          }}
        >
          <Text>Error on loading chat. Please, try again later</Text>
          <OrDelimiter>Or</OrDelimiter>
          <Button onPress={() => setShowModal(false)} style={{ width: "100%" }}>
            Enter with default account
          </Button>
        </View>
      ) : user && user.xmppPassword !== "" ? (
        <ChatWrapper
          {...props}
          CustomMessageComponent={props.CustomMessageComponent}
          CustomInputComponent={props.CustomInputComponent}
          CustomScrollableArea={props.CustomScrollableArea}
          CustomDaySeparator={props.CustomDaySeparator}
          CustomNewMessageLabel={props.CustomNewMessageLabel}
        />
      ) : config && config.jwtLogin && config.jwtLogin.enabled ? (
        <StyledLoaderWrapper
          style={{
            alignItems: "center",
            flexDirection: "column",
            gap: "10px",
            padding: 20,
          }}
        >
          <Loader color={config?.colors?.primary} />
          {user && (user._id || user.email || user.xmppUsername) ? (
            <View
              style={{
                marginTop: 16,
                alignItems: "center",
                gap: 8,
                width: "100%",
              }}
            >
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: "700",
                  color: "#333",
                  marginBottom: 8,
                }}
              >
                User Data from Store:
              </Text>

              {user.firstName || user.lastName ? (
                <Text
                  style={{ fontSize: 14, fontWeight: "600", color: "#333" }}
                >
                  {user.firstName} {user.lastName}
                </Text>
              ) : null}

              {user.email && (
                <Text style={{ fontSize: 12, color: "#666" }}>
                  📧 {user.email}
                </Text>
              )}

              {user._id && (
                <Text style={{ fontSize: 11, color: "#999" }}>
                  ID: {user._id}
                </Text>
              )}

              {user.xmppUsername && (
                <Text style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                  💬 XMPP: {user.xmppUsername}
                </Text>
              )}

              {(user.defaultWallet?.walletAddress || user.walletAddress) && (
                <Text style={{ fontSize: 11, color: "#999" }}>
                  💰 Wallet:{" "}
                  {user.defaultWallet?.walletAddress || user.walletAddress}
                </Text>
              )}

              {user.appId && (
                <Text style={{ fontSize: 11, color: "#999" }}>
                  App ID: {user.appId}
                </Text>
              )}

              {user.profileImage && (
                <Text
                  style={{ fontSize: 10, color: "#999", fontStyle: "italic" }}
                >
                  Has profile image
                </Text>
              )}

              <View
                style={{
                  marginTop: 12,
                  paddingTop: 12,
                  borderTopWidth: 1,
                  borderTopColor: "#eee",
                  width: "100%",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: 11, color: "#999" }}>
                  {user.token ? "✅ Token: Present" : "❌ Token: Missing"}
                </Text>
                <Text style={{ fontSize: 11, color: "#999" }}>
                  {user.refreshToken
                    ? "✅ Refresh Token: Present"
                    : "❌ Refresh Token: Missing"}
                </Text>
                <Text style={{ fontSize: 11, color: "#999" }}>
                  {user.xmppPassword
                    ? "✅ XMPP Password: Present"
                    : "❌ XMPP Password: Missing"}
                </Text>
              </View>

              {user.roles && user.roles.length > 0 && (
                <Text style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
                  Roles: {user.roles.join(", ")}
                </Text>
              )}
            </View>
          ) : (
            <View style={{ alignItems: "center", gap: 8 }}>
              <Text style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
                Authenticating with JWT token...
              </Text>
              <Text
                style={{ fontSize: 10, color: "#999", fontStyle: "italic" }}
              >
                Waiting for user data from store...
              </Text>
            </View>
          )}
        </StyledLoaderWrapper>
      ) : (
        <LoginForm {...props} />
      )}
    </View>
    // <>
    //   {showModal ? (
    //     <Container>
    //       <Message>Error on loading chat. Please, try again later</Message>
    //       <OrDelimiter>Or</OrDelimiter>
    //       <CustomButton onPress={() => setShowModal(false)}>
    //         <ButtonText>Enter with default account</ButtonText>
    //       </CustomButton>
    //     </Container>
    //   ) : (
    //     <ChatWrapper />
    //   )}
    // </>
  );
};

export default LoginWrapper;
