import React, {useCallback, useEffect, useState} from 'react';
import {IConfig, MessageProps, User} from '../../types/types';
import {ChatWrapper} from './ChatWrapper';
import {RootState} from '../../roomStore';
import {useDispatch, useSelector} from 'react-redux';
import {logout, setConfig, setUser} from '../../roomStore/chatSettingsSlice';
import {loginEmail} from '../../networking/api-requests/auth.api';
import {OrDelimiter} from '../styled/StyledComponents';
import {Text, View, ViewStyle} from 'react-native';
import Button from '../styled/Button';
import LoginForm from '../AuthForms/Login';
import {useLocalStorage} from '../../hooks/useLocalStorage';
import {localStorageConstants} from '../../helpers/constants/LOCAL_STORAGE';
import {setLogoutState} from '../../roomStore/roomsSlice';

interface LoginWrapperProps {
  user?: {email: string; password: string};
  MainComponentStyles?: ViewStyle;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
  roomJID?: string;
}

const LoginWrapper: React.FC<LoginWrapperProps> = ({...props}) => {
  const dispatch = useDispatch();
  const {user} = useSelector((state: RootState) => state.chatSettingStore);

  const [showModal, setShowModal] = useState(false);

  const loginUserFunction = useCallback(async () => {
    try {
      const authData = await loginEmail(
        props?.user?.email || 'yukiraze9@gmail.com',
        props?.user?.password || 'Qwerty123',
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

  useEffect(() => {
    if (props.config?.clearStoreBeforeInit) {
      dispatch(setLogoutState());
      dispatch(logout());
      dispatch(setConfig(props.config));
    }
  }, [props.config?.clearStoreBeforeInit]);

  useEffect(() => {
    if (
      props?.config?.customLogin?.enabled &&
      typeof props?.config?.customLogin?.loginFunction === 'function'
    ) {
      // const performCustomLogin = async (
      //   loginFunction: () => Promise<User>,
      // ): Promise<User | null> => {
      //   try {
      //     const user = await loginFunction();
      //     console.log(user, 'herrerre')
      //     return user;
      //   } catch (error) {
      //     console.error('Custom login failed', error);
      //     return null;
      //   }
      // };
      // (async () => {
      //   const customLoginUser = await performCustomLogin(
      //     props?.config?.customLogin?.loginFunction,
      //   );
      //   if (customLoginUser) {
      //     dispatch(setUser(customLoginUser));
      //   }
      // })();
    }

    if (props?.config?.userLogin?.enabled && props?.config?.userLogin?.user) {
      dispatch(setUser(props.config.userLogin.user));
      return;
    }

    //if no login config - default user login
    const initializeStoredUser = async () => {
      const storedUser: User = (await useLocalStorage(
        localStorageConstants.ETHORA_USER,
      ).get()) as User;
      if (storedUser) {
        console.log('Login data storedUser', storedUser);
        dispatch(setUser(storedUser));
      }
    };

    initializeStoredUser();

    if (
      !props.config?.googleLogin &&
      !props.config?.defaultLogin &&
      !props.config?.jwtLogin &&
      !props.config?.userLogin &&
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
            ...props.MainComponentStyles,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexDirection: 'column',
            padding: 20,
            gap: 8,
          }}>
          <Text>Error on loading chat. Please, try again later</Text>
          <OrDelimiter>Or</OrDelimiter>
          <Button onPress={() => setShowModal(false)} style={{width: '100%'}}>
            Enter with default account
          </Button>
        </View>
      ) : (user && user.xmppPassword !== '') || (props?.config?.userLogin?.enabled && props?.config?.userLogin?.user) ? (
        <ChatWrapper {...props} />
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
