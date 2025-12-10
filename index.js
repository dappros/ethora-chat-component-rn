/**
 * @format
 */

import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import {name as appName} from './app.json';
import 'react-native-get-random-values';

// Background message handler (must be registered before AppRegistry)
messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('Background message:', remoteMessage);
});

AppRegistry.registerComponent(appName, () => App);
