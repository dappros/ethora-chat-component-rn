import React, { useCallback, useEffect, useState } from "react";
import { IConfig, MessageProps, User } from "../../types/types";
import { ChatWrapper } from "./ChatWrapper";
import { RootState } from "../../roomStore";
import { useDispatch, useSelector } from "react-redux";
import { logout, setConfig, setUser } from "../../roomStore/chatSettingsSlice";
import { loginEmail, loginViaJwt } from "../../networking/api-requests/auth.api";
import { OrDelimiter } from "../styled/StyledComponents";
import { Text, View, ViewStyle } from "react-native";
import Button from "../styled/Button";
import LoginForm from "../AuthForms/Login";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { localStorageConstants } from "../../helpers/constants/LOCAL_STORAGE";
import { setLogoutState } from "../../roomStore/roomsSlice";
import { setBaseURL } from "../../networking/apiClient";
import Loader from '../styled/Loader';

interface LoginWrapperProps {
  user?: { email: string; password: string };
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
  roomJID?: string;
}

const LoginWrapper: React.FC<LoginWrapperProps> = ({ ...props }) => {
  const [showModal, setShowModal] = useState(false);
  const { config, MainComponentStyles } = props;

  const { user } = useSelector((state: RootState) => state.chatSettingStore);

  const loginUserFunction = useCallback(async () => {
    try {
      const authData = await loginEmail(
        props?.user?.email || 'yukiraze9@gmail.com',
        props?.user?.password || 'Qwerty123'
      );

      return {
        ...authData.data.user,
        token: authData.data.token,
        refreshToken: authData.data.refreshToken,
      };
    } catch (error) {
      console.error('Login failed:', error);
      return null;
    }
  }, []);

  const dispatch = useDispatch();

  useEffect(() => {
    if (config?.baseUrl) {
      setBaseURL(config?.baseUrl, config?.customAppToken);
    }
    if (config?.userLogin?.enabled && config?.userLogin?.user) {
      dispatch(setUser(config.userLogin.user));
      return;
    }

    //use localStorage, to check for user was already logged

    const checkStoredUser = async () => {
      const storedUser = (await useLocalStorage(
        '@ethora/chat-component-user'
      ).get()) as User | null;
      if (storedUser) {
        dispatch(setUser(storedUser));
      }
    };
    checkStoredUser();

    //if jwt send api req with jwt and get user data

    if (config?.jwtLogin?.enabled) {
      const jwtLogin = async () => {
        try {
          if(!config?.jwtLogin?.token) return;
          
          const loginData = await loginViaJwt(config.jwtLogin.token);
          if (loginData) {
            dispatch(setUser(loginData));
          }
        } catch (error) {
          console.log('error with jwt login', error);
          setShowModal(true);
          console.log('Error, no user');
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
      user.xmppUsername === ''
    ) {
      const defaultLogin = async () => {
        try {
          const loginData = await loginUserFunction();
          if (loginData) {
            dispatch(setUser(loginData));
          }
        } catch (error) {
          console.log('error with default login', error);
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
    <View>
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
        <ChatWrapper {...props} />
        ) : config && config.jwtLogin && config.jwtLogin.enabled ? (
        <Loader />
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
