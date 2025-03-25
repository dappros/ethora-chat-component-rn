import * as React from 'react';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {ROUTES} from '../constants/routes';
import LoginScreen from '../screens/LoginScreen';
import RegistrationStepOneScreen from '../screens/RegisterStepOneScreen';
import RegisterStepTwoScreen from '../screens/RegisterStepTwoScreen';

const Stack = createNativeStackNavigator();

const AuthStack = () => {
  return (
    <Stack.Navigator>
      <Stack.Screen
        options={() => ({
          headerShown: false,
          headerTitle: '',
        })}
        component={LoginScreen}
        name={ROUTES.LOGIN}
      />
      <Stack.Screen
        options={() => ({
          headerShown: false,
          headerTitle: '',
        })}
        component={RegistrationStepOneScreen}
        name={ROUTES.REGISTERONE}
      />
      <Stack.Screen
        options={() => ({
          headerShown: false,
          headerTitle: '',
        })}
        component={RegisterStepTwoScreen}
        name={ROUTES.REGISTERTWO}
      />
    </Stack.Navigator>
  );
};

export default AuthStack;
