import { Middleware } from '@reduxjs/toolkit';
import { DeviceEventEmitter } from 'react-native';

export const logoutMiddleware: Middleware =
  (storeAPI) => (next) => (action: any) => {
    if (!action || !action.type) {
      console.error('Invalid action in logoutMiddleware:', action);
      return next(action);
    }

    const result = next(action);

    // Action type uses the slice's `name`, not the store key —
    // chatSettingsSlice is registered with `name: 'chat'`, so the
    // logout action type is `chat/logout`. Filtering on
    // `chatSettingStore/logout` (the store key) silently never fires,
    // which means the XMPP transport never sees the logout signal.
    if (action.type === 'chat/logout') {
      // Capture the emitter reference outside the timer body so a Jest
      // teardown that nulls out the lazy `react-native` exports between
      // dispatch and the 0-delay timer firing can't crash the timer.
      const emitter = DeviceEventEmitter;
      setTimeout(() => {
        try {
          emitter?.emit?.('ethora-xmpp-logout');
        } catch (error) {
          console.error('Error dispatching ethora-xmpp-logout event:', error);
        }
      }, 0);
    }

    return result;
  };
