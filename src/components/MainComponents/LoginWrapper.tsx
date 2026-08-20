import React, {useCallback, useEffect, useState} from 'react';
import {IConfig, MessageProps} from '../../types/types';
import {ChatWrapper} from './ChatWrapper';
import {RootState} from '../../roomStore';
import {useDispatch, useSelector} from 'react-redux';
import {setUser} from '../../roomStore/chatSettingsSlice';
import {loginEmail} from '../../networking/api-requests/auth.api';
import {OrDelimiter} from '../styled/StyledComponents';
import {ButtonText, Container, CustomButton, Message} from './RNStyled';
import {Text} from 'react-native';

interface LoginWrapperProps {
  user?: {email: string; password: string};
  MainComponentStyles?: React.CSSProperties;
  CustomMessageComponent?: React.ComponentType<MessageProps>;
  config?: IConfig;
  roomJID?: string;
}

const LoginWrapper: React.FC<LoginWrapperProps> = ({...props}) => {
  const [showModal, setShowModal] = useState(false);

  const {user} = useSelector((state: RootState) => state.chatSettingStore);

  const loginUserFunction = useCallback(async () => {
    try {
      // Per product-code-policy: no compiled-in dev credentials. If the
      // consumer didn't pass `user.email` / `user.password`, the call
      // below fails on empty strings, hits catch, and returns null.
      const authData = await loginEmail(
        props?.user?.email || '',
        props?.user?.password || '',
      );

      return {
        ...authData.data.user,
        token: authData.data.token,
        refreshToken: authData.data.refreshToken,
        fileToken: (authData.data as any).fileToken || '',
      };
    } catch (error) {
      console.error('Login failed:', error);
      return null;
    }
  }, []);

  const dispatch = useDispatch();

  useEffect(() => {
    // When config.initBeforeLoad is enabled, the XmppProvider owns user
    // resolution end-to-end. Skip the legacy login paths here so we don't
    // race against the provider's resolveInitBeforeLoadUser pipeline.
    if (props?.config?.initBeforeLoad) {
      return;
    }

    if (props?.config?.userLogin?.enabled && props?.config?.userLogin?.user) {
      dispatch(setUser(props.config.userLogin.user));
      return;
    }

    //if no login config - default user login

    if (
      !props.config?.googleLogin &&
      !props.config?.defaultLogin &&
      !props.config?.jwtLogin &&
      !props.config?.userLogin &&
      !props.config?.customLogin &&
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
    // <>
    //   {showModal ? (
    //     <View
    //       style={{
    //         ...props.MainComponentStyles,
    //         display: 'flex',
    //         justifyContent: 'center',
    //         alignItems: 'center',
    //         flexDirection: 'column',
    //         padding: '20px',
    //         gap: '8px',
    //       }}
    //     >
    //       <p>Error on loading chat. Please, try again later</p>
    //       <OrDelimiter>Or</OrDelimiter>
    //       <Button onClick={() => setShowModal(false)} style={{ width: '100%' }}>
    //         Enter with default account
    //       </Button>
    //     </View>
    //   ) : user && user.xmppPassword !== '' ? (
    //     <ChatWrapper {...props} />
    //   ) : (
    //     <LoginForm {...props} />
    //   )}
    // </>
    <>
      {showModal ? (
        <Container>
          <Message>Error on loading chat. Please, try again later</Message>
          <OrDelimiter>Or</OrDelimiter>
          <CustomButton onPress={() => setShowModal(false)}>
            <ButtonText>Enter with default account</ButtonText>
          </CustomButton>
        </Container>
      ) : (
        // CRITICAL: forward props so `ChatWrapper` sees `config` (and
        // therefore `initBeforeLoad`, `xmppSettings`, `refreshTokens`,
        // etc.). Without this, ChatWrapper's effect can't tell that
        // XmppProvider owns bootstrap and races against it.
        <ChatWrapper {...props} />
      )}
    </>
  );
};

export default LoginWrapper;
