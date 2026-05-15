import { useCallback, useEffect, useState } from 'react';
import { useXmppClient } from '../context/xmppProvider';
import { useSelector } from 'react-redux';
import { RootState } from '../roomStore';
import { useChatSettingState } from './useChatSettingState';
import { IConfig } from '../types/types';

const useComposing = (config?: IConfig) => {
  const { client } = useXmppClient();
  const { activeRoomJID } = useSelector((state: RootState) => state.rooms);
  const { user } = useChatSettingState();

  const sendStartComposing = useCallback(() => {
    console.log('🟣 [useComposing] start', {
      hasClient: !!client,
      room: activeRoomJID,
      disabled: !!config?.disableTypingIndicator,
    });
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
    console.log('🟣 [useComposing] end', {
      hasClient: !!client,
      room: activeRoomJID,
    });
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

  return { sendStartComposing, sendEndComposing };
};

export default useComposing;
