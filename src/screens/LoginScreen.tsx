import React, {useCallback, useMemo, useState} from 'react';
import {
  VStack,
  KeyboardAvoidingView,
  View,
  Text,
} from 'native-base';
import {
  Keyboard,
  Platform,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
} from 'react-native';
import {runInAction} from 'mobx';
import {useStores} from '../stores/context';
import {LargeTitle} from '../components/LargeTitle';
import {CustomInput} from '../components/CustomInput';
import {LinearGradientButton} from '../components/LinearGradientButton';
import {showError, showSuccess} from '../components/Toast/toast';
import {textStyles} from '../config/config';
import {heightPercentageToDP as hp} from 'react-native-responsive-screen';
import {observer} from 'mobx-react-lite';
import {useLocalStorage} from '../hooks/useLocalStorage';
import {
  KeyboardAnimated,
  useKeyboardAnimation,
} from '../hooks/useKeyboardAnimation';
import {debounce} from 'lodash';
import { SelectLanguage } from '../components/UI/SelectLanguage';
import { AtomLogo } from '../components/svg/AtomLogo';
import { PreviewScreen } from './PreviewScreen';
import { useNavigation } from '@react-navigation/native';
import { NavigationProps, ROUTES } from '../constants/routes';
import Logo from '../assets/logo//Logo.svg';

const invalidCharactersRegex = /[^a-zA-Z0-9\s\-#&\.\@]/;

const LoginScreen = observer(() => {
  const navigation = useNavigation<NavigationProps>();
  // const dispatch = useDispatch();
  const {loginStore} = useStores();
  const [lastName, setLastName] = useState('');
  const [claimNumbers, setClaimNumbers] = useState('');
  const [loading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState({
    lastName: '',
    claimNumbers: '',
    injuryDate: false,
  });
  const [loungeOtion, setLoungeOtion] = useState('en');

  const ifNoErrors = useMemo(
    () => Object.values(errors).every(error => !error),
    [errors],
  );

  const {isKeyboardVisible} = useKeyboardAnimation(1, 150, 150);

  const validateValue = useCallback(
    debounce((value: string, name: 'lastName' | 'claimNumbers') => {
      if (value.length <= 2) {
        setErrors(error => ({
          ...error,
          [name]: 'Must be longer than 2 characters.',
        }));
        return;
      }

      if (invalidCharactersRegex.test(value)) {
        setErrors(error => ({
          ...error,
          [name]: 'Contains invalid characters.',
        }));
        return;
      }

      setErrors(error => ({...error, [name]: ''}));
    }, 1000),
    [],
  );

  const regularLoadingSubmit = async () => {
    if (!lastName || !claimNumbers) {
      return;
    }

    runInAction(() => setIsLoading(true));
    try {
      await loginStore
        .login({
          lastName: lastName?.toLowerCase().trim(),
          claimNumber: claimNumbers.trim(),
        })
        .then(() => {
          showSuccess('Success', 'You have successfully logged in.');
          useLocalStorage('translates').set(loungeOtion);
        });
      runInAction(() => setIsLoading(false));
    } catch (error) {
      console.log('login error', error);
      showError('Error', 'Incorrect data. Please, try again');
    }
    runInAction(() => setIsLoading(false));
  };

  const handleLastNameInput = (data: any) => {
    validateValue(data, 'lastName');
    setLastName(data);
  };

  const handleClaimNumbersInput = (data: any) => {
    validateValue(data, 'claimNumbers');
    setClaimNumbers(data);
  };


  if(loginStore.prewview) {
    return <PreviewScreen/>
  }

  return (
    <KeyboardAvoidingView
    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={{flex: 1}}
    keyboardVerticalOffset={Platform.OS === 'ios' ? 42 : 0}>
      <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
        <VStack
          style={{
            width: '100%',
            height: '100%',
            alignItems: 'center',
            flexDirection: "column",
            backgroundColor: '#ffffff'
          }}>
          <VStack
            w="full"
            paddingX={4}
            style={{
              flexDirection: 'column',
              gap: 2,
            }}>
            <KeyboardAnimated>
              <VStack
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingTop: 32,
                  paddingBottom: 16,
                }}
                w="full">
                <VStack
                  style={{
                    paddingVertical: 16,
                    alignItems: 'center',
                    gap: 4,
                    marginTop: isKeyboardVisible ? 24 : 0,
                  }}>
                  <LargeTitle
                    text="Access Your Account to Start"
                    style={{
                      fontSize: 22,
                      lineHeight: 32,
                      color: '#53575A',
                    }}
                  />
                  <Text
                    style={{
                      fontSize: hp('1.5%'),
                      fontWeight: '500',
                      textAlign: 'center',
                      width: '100%',
                      color: '#53575A',
                      fontFamily: textStyles.boldFont,
                    }}>
                    Please enter your last name, claim number & injury date.
                  </Text>
                </VStack>
              </VStack>

              <CustomInput
                value={lastName}
                onChangeText={handleLastNameInput}
                placeholder="Email"
                isError={!!errors.lastName}
                helperText={errors.lastName}
              />
              <CustomInput
                isPassword
                value={claimNumbers}
                onChangeText={handleClaimNumbersInput}
                placeholder="Password"
                isError={!!errors.claimNumbers}
                helperText={errors.claimNumbers}
              />

              
              <SelectLanguage
                backgroundColor='#F5F5F5'
                loungeOtion={loungeOtion}
                setLoungeOtion={setLoungeOtion}
              />

              <LinearGradientButton
                loading={loading}
                onPress={regularLoadingSubmit}
                style={styles.buttonStyle}
                title="Log In"
                disabled={
                  !claimNumbers || !lastName || !ifNoErrors
                }></LinearGradientButton>

                <VStack
                  style={{
                    paddingVertical: 16,
                    alignItems: 'center',
                    gap: 4,
                    marginTop: isKeyboardVisible ? 24 : 0,
                  }}>
                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '500',
                      textAlign: 'center',
                      width: '100%',
                      color: '#424242',
                      fontFamily: textStyles.boldFont,
                    }}>
                    Your information is secure and protected under 
                    HIPAA compliance.
                  </Text>
                </VStack>
                <VStack style={{
                  width: '100%',
                  justifyContent: 'center',
                  alignItems: 'center'
                }}>
                  <Text>
                    dont have account
                  </Text>
                  <TouchableOpacity onPress={() => navigation.navigate(ROUTES.REGISTERONE)}>
                    <Text style={{color: '#2962FF'}}>Sign in</Text>
                  </TouchableOpacity>
                </VStack>
            </KeyboardAnimated>
          </VStack>
          <VStack paddingTop={20}>
            <AtomLogo width={240} height={56}/>
          </VStack>
        </VStack>
      </TouchableWithoutFeedback>
    </KeyboardAvoidingView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'center',
  },
  buttonStyle: {
    width: '100%',
  },
  bgContainer: {
    width: '100%',
    minHeight: 380,
  },
});

export default LoginScreen;
