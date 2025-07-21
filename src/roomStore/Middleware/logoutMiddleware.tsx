import { Middleware } from '@reduxjs/toolkit';
import { DeviceEventEmitter } from 'react-native';

export const logoutMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (!action || !action.type) {
      console.error('Invalid action in logoutMiddleware:', action);
      return next(action);
    }

    const result = next(action);

    if (action.type === 'chatSettingStore/logout') {
      try {
        setTimeout(() => {
          DeviceEventEmitter.emit('ethora-xmpp-logout');
        }, 0);
      } catch (error) {
        console.error('Error dispatching ethora-xmpp-logout event:', error);
      }
    }

    return result;
  };
