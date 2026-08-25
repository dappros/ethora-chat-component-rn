import React, { useState, useEffect, useCallback } from 'react';
import styled from 'styled-components/native';
import { MessageInput } from '../styled/StyledComponents';
import Button from '../styled/Button';
import { GoogleIcon } from '../../assets/icons';
import { IConfig } from '../../types/types';
import {
  checkEmailExist,
  loginEmail,
  loginSocial,
  registerSocial,
  // signInWithGoogle,
} from '../../networking/api-requests/auth.api';
import { useDispatch } from 'react-redux';
import { secureUserStorage } from '../../helpers/secureUserStorage';
import { setUser, unpackAndTransform } from '../../roomStore/chatSettingsSlice';
import { Text, TextInput, View } from 'react-native';

interface LoginFormProps {
  config?: IConfig;
}

const LoginForm: React.FC<LoginFormProps> = ({ config }) => {
  const dispatch = useDispatch();
  const { set } = secureUserStorage();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({ email: '', password: '' });

  const validateForm = () => {
    let emailError = '';
    let passwordError = '';

    if (!/\S+@\S+\.\S+/.test(email)) {
      emailError = 'Invalid email format';
    }

    if (password.length < 6) {
      passwordError = 'Password must be at least 6 characters long';
    }

    return { emailError, passwordError };
  };

  const handleRegularLogin = useCallback(async () => {
    setIsLoading(true);

    try {
      const authData = await loginEmail(email, password);

      if (authData?.status === 401) {
        setErrors((prev) => ({
          ...prev,
          password: 'You entered wrong data. Try again',
        }));
        setIsLoading(false);
        return null;
      }

      const user = {
        ...authData.data.user,
        token: authData.data.token,
        refreshToken: authData.data.refreshToken,
        fileToken: (authData.data as any).fileToken || '',
      };
      dispatch(setUser(user));

      await set(unpackAndTransform(user));
    } catch (error) {
      console.error('Login failed:', error);
      setIsLoading(false);

      return null;
    }
    setIsLoading(false);
  }, [email, password, dispatch]);

  // const handleGoogleLogin = async () => {
  //   setIsLoading(true);

  //   const loginType = "google";

  //   try {
  //     const res = await signInWithGoogle();

  //     const emailExist = await checkEmailExist(
  //       res.user?.providerData[0].email || ""
  //     );

  //     if (!emailExist.data.success) {
  //       try {
  //         await registerSocial(
  //           res.idToken || "",
  //           res.credential?.accessToken || "",
  //           "",
  //           loginType
  //         );
  //         const loginRes = await loginSocial(
  //           res.idToken || "",
  //           res.credential?.accessToken || "",
  //           loginType
  //         );
  //         console.log("google log after register res", loginRes);

  //         const user = {
  //           ...loginRes.data.user,
  //           token: loginRes.data.token,
  //           refreshToken: loginRes.data.refreshToken,
  //         };
  //         dispatch(setUser(user));
  //         useLocalStorage(localStorageConstants.ETHORA_USER).set(user);
  //       } catch (error) {
  //         console.log("error registering user viag google");
  //       }
  //     }
  //     if (res.idToken && res.credential && res.credential.accessToken) {
  //       const loginRes = await loginSocial(
  //         res.idToken,
  //         res.credential.accessToken,
  //         loginType
  //       );
  //       console.log("google log res", loginRes);
  //       const user = {
  //         ...loginRes.data.user,
  //         token: loginRes.data.token,
  //         refreshToken: loginRes.data.refreshToken,
  //       };
  //       dispatch(setUser(user));
  //       useLocalStorage(localStorageConstants.ETHORA_USER).set(user);
  //     }
  //   } catch (error) {
  //     console.log(error);
  //   }
  //   setIsLoading(false);
  // };

  const handleSubmit = () => {
    const { emailError, passwordError } = validateForm();

    setErrors({ email: emailError, password: passwordError });

    if (!emailError && !passwordError) {
      handleRegularLogin();
    }
  };

  return (
    <FormContainer>
      <Form>
        <View
          style={{
            height: 40,
            width: '100%',
            display: 'flex',
            gap: 4,
            flexDirection: 'column',
          }}
        >
          {/* <TextInput value={email} onChangeText={(text) => setEmail(text)} /> */}
          <MessageInput
            value={email}
            placeholder="Email"
            onChangeText={(text) => setEmail(text)}
            style={{
              borderWidth: 1,
              borderColor: config ? config.colors?.primary : '#3498db',
              borderRadius: 4,
            }}
          />
          <Text>
            {errors.email && <ErrorMessage>{errors.email}</ErrorMessage>}
          </Text>
        </View>

        <View
          style={{
            height: 40,
            width: '100%',
            display: 'flex',
            gap: 4,
            flexDirection: 'column',
          }}
        >
          <MessageInput
            value={password}
            placeholder="Password"
            onChangeText={(text) => setPassword(text)}
            style={{
              borderWidth: 1,
              borderColor: config ? config.colors?.primary : '#3498db',
              borderRadius: 4,
            }}
          />
          <Text>
            {' '}
            {errors.password && <ErrorMessage>{errors.password}</ErrorMessage>}
          </Text>
        </View>

        <Button
          onPress={handleSubmit}
          text="Login to Ethora Chat"
          style={{
            width: '100%',
            height: 40,
            backgroundColor: config?.colors?.primary || '#0052CD',
          }}
          color="white"
          disabled={isLoading}
          loading={isLoading}
        />
        {config?.googleLogin?.enabled && (
          <>
            <Delimiter>or</Delimiter>
            <Button
              // onPress={handleGoogleLogin}
              text="Login with Google"
              EndIcon={<GoogleIcon style={{ height: 24 }} />}
              disabled={isLoading}
            />
          </>
        )}
        <View>
          <Text>Don't have an account? </Text>
          <Text
            style={{
              textDecorationLine: 'underline',
              color: '#0052CD',
              fontSize: 14,
              display: 'flex',
              fontWeight: '400',
            }}
          >
            Sign Up to Ethora
          </Text>
        </View>
      </Form>
    </FormContainer>
  );
};

// Styled Components
const FormContainer = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  width: 100%;
  background-color: #f5f5f5;
`;

const Form = styled.View`
  flex-direction: column;
  align-items: center;
  background-color: white;
  padding: 30px;
  border-radius: 8px;
  width: 300px;
  gap: 16px;
`;

const ErrorMessage = styled.Text`
  color: red;
  font-size: 12px;
  margin-bottom: 10px;
`;

const Delimiter = styled.Text`
  text-align: center;
  position: relative;
  width: 100%;
  font-size: 14px;
  color: #999;

  &::before,
  &::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 45%;
    height: 1px;
    background: #ccc;
  }

  &::before {
    left: 0;
  }

  &::after {
    right: 0;
  }
`;

export default LoginForm;
