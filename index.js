/**
 * @format
 */

import {AppRegistry} from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import {name as appName} from './app.json';
import 'react-native-get-random-values';
// import notifee from '@notifee/react-native';

messaging().setBackgroundMessageHandler(async (remoteMessage) => {
  console.log('Background message received:', JSON.stringify(remoteMessage, null, 2));
  
  if (remoteMessage.notification || remoteMessage.data) {
    const { notification, data } = remoteMessage;
    
    const { Platform } = require('react-native');
    // if (Platform.OS === 'android') {
    //   try {
    //     await notifee.displayNotification({
    //       title: notification?.title || data?.title,
    //       body: notification?.body || data?.body,
    //       android: {
    //         channelId: 'default',
    //         importance: 4,
    //         pressAction: {
    //           id: 'default',
    //         },
    //         data: data || {},
    //       },
    //       data: data || {},
    //     });
    //     console.log('Background notification displayed');
    //   } catch (error) {
    //     console.error('Error displaying background notification:', error);
    //   }
    // }
  }
});

AppRegistry.registerComponent(appName, () => App);
