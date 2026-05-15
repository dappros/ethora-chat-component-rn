import { useDispatch } from 'react-redux';
import { DeviceEventEmitter } from 'react-native';
import { store } from '../roomStore';
import { logout } from '../roomStore/chatSettingsSlice';
import { setLogoutState } from '../roomStore/roomsSlice';
import { useCallback } from 'react';
import { clearHeap } from '../roomStore/roomHeapSlice';
import { pushSubscriptionService } from '../services/pushSubscriptionService';

const logoutService = {
  performLogout: () => {
    // Clear any pending notifications
    DeviceEventEmitter.emit('chat:clear-notifications');

    pushSubscriptionService.reset();
    store.dispatch(logout());
    store.dispatch(setLogoutState());
    store.dispatch(clearHeap());
  },
};
export const useLogout = () => {
  const dispatch = useDispatch();

  const handleLogout = useCallback(() => {
    logoutService.performLogout();
  }, []);

  return handleLogout;
};

export { logoutService };
