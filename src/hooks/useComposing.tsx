import { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useXmppClient } from '../context/xmppProvider';
import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';
import { useChatSettingState } from './useChatSettingState';
import { IConfig } from '../types/types';

const useComposing = (config?: IConfig) => {
  const { client } = useXmppClient();
  const { activeRoomJID } = useSelector((state: RootState) => state.rooms);
  const { user } = useChatSettingState();
  // RN keeps a focused TextInput focused when the app is backgrounded or
  // the device is locked — nothing fires `onBlur`, so without this the
  // other participant sees "typing…" for as long as the user is away.
  // Tracks whether the input is *currently* focused, independent of the
  // foreground/background transition, so we know whether to resume
  // composing on return.
  const isFocusedRef = useRef(false);

  const sendStartComposing = useCallback(() => {
    isFocusedRef.current = true;
    if (config?.disableTypingIndicator) {
      return;
    }
    if (client) {
      client.sendTypingRequestStanza(
        activeRoomJID || '',
        `${user.firstName} ${user.lastName}`,
        true
      );
    }
  }, [activeRoomJID, client, config?.disableTypingIndicator, user.firstName, user.lastName]);

  const sendEndComposing = useCallback(() => {
    isFocusedRef.current = false;
    if (config?.disableTypingIndicator) {
      return;
    }
    if (client) {
      client.sendTypingRequestStanza(
        activeRoomJID || '',
        `${user.firstName} ${user.lastName}`,
        false
      );
    }
  }, [activeRoomJID, client, config?.disableTypingIndicator, user.firstName, user.lastName]);

  useEffect(() => {
    const timerId = setTimeout(() => {
      sendEndComposing();
    }, 100);

    return () => clearTimeout(timerId);
  }, [sendEndComposing]);

  // Foreground/background transition only — a pause in typing must NOT
  // clear the indicator (that would flicker for a slowly-composing user),
  // so this deliberately does not hook keystroke/idle timing at all.
  useEffect(() => {
    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState !== 'active') {
        if (isFocusedRef.current && !config?.disableTypingIndicator && client) {
          client.sendTypingRequestStanza(
            activeRoomJID || '',
            `${user.firstName} ${user.lastName}`,
            false
          );
        }
      } else if (isFocusedRef.current && !config?.disableTypingIndicator && client) {
        client.sendTypingRequestStanza(
          activeRoomJID || '',
          `${user.firstName} ${user.lastName}`,
          true
        );
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [activeRoomJID, client, config?.disableTypingIndicator, user.firstName, user.lastName]);

  return { sendStartComposing, sendEndComposing };
};

export default useComposing;
