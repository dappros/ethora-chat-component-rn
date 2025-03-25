/*
Copyright 2019-2024 (c) Dappros Ltd, registered in England & Wales, registration number 11455432. All rights reserved.
You may not use this file except in compliance with the License.
You may obtain a copy of the License at https://github.com/dappros/pericon/blob/main/LICENSE.
Note: linked open-source libraries and components may be subject to their own licenses.
*/

import { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type RootStackParamList = {
  AuthStackScreen: undefined;
  MainStackScreen: undefined;
  LoginScreen: undefined;
  RegistrationStepOneScreen: undefined;
  RegisterStepTwoScreen: { id: string };
  Chat: undefined;
  Account: undefined;
  NoRoomScreen: undefined;
};

export type NavigationProps = NativeStackNavigationProp<RootStackParamList>;


export const ROUTES = {
  AUTHSTACK: 'AuthStackScreen',
  MAINSTACK: 'MainStackScreen',
  LOGIN: 'LoginScreen',
  REGISTERONE: 'RegistrationStepOneScreen',
  REGISTERTWO: 'RegisterStepTwoScreen',
  CHAT: 'Chat',
  ACCOUNT: 'Account',
  NOROOM: 'NoRoomScreen',
} as const;
