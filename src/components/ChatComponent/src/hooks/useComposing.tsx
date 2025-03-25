import {useCallback, useEffect, useState} from 'react';
import {useXmppClient} from '../context/xmppProvider';
import {useSelector} from 'react-redux';
import {RootState} from '../roomStore';
import {useChatSettingState} from './useChatSettingState';

const useComposing = (text: string) => {
  const {client} = useXmppClient();
  const {activeRoomJID} = useSelector((state: RootState) => state.rooms);
  const {user} = useChatSettingState();
  const [lastText, setLastText] = useState(text);

  const sendStartComposing = useCallback(() => {
    client.sendTypingRequestStanza(
      activeRoomJID,
      `${user.firstName} ${user.lastName}`,
      true,
    );
  }, [activeRoomJID, user]);

  const sendEndComposing = useCallback(() => {
    client.sendTypingRequestStanza(
      activeRoomJID,
      `${user.firstName} ${user.lastName}`,
      false,
    );
  }, [activeRoomJID, user]);

  useEffect(() => {
    if (text !== lastText) {
      sendStartComposing();
      setLastText(text);
    }

    const timerId = setTimeout(() => {
      sendEndComposing();
    }, 2000);

    return () => clearTimeout(timerId);
  }, [text, sendStartComposing, sendEndComposing]);

  useEffect(() => {
    return () => {
      sendEndComposing();
    };
  }, [sendEndComposing]);

  return {sendStartComposing, sendEndComposing};
};

export default useComposing;
