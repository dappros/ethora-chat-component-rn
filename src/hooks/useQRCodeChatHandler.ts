import { useEffect, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import AsyncStorage from '@react-native-async-storage/async-storage';

const QR_CHAT_STORAGE_KEY = '@ethora/chat-component-qrChatId';

export const useQRCodeChat = (
  setCurrentRoom: (params: { roomJID: string }) => void,
  conferenceServer?: string
) => {
  const [wasAutoSelected, setWasAutoSelected] = useState(false);

   useEffect(() => {
    (async () => {
      try {
        const qrChatId = await AsyncStorage.getItem(QR_CHAT_STORAGE_KEY);

        if (qrChatId) {
          const roomJID = conferenceServer
            ? `${qrChatId}@${conferenceServer}`
            : `${qrChatId}@conference.xmpp.ethoradev.com`;

          setCurrentRoom({ roomJID });

          await AsyncStorage.removeItem(QR_CHAT_STORAGE_KEY);

          setWasAutoSelected(true);
        }
      } catch (error) {
        console.error('Error using QR chat selection:', error);
      }
    })();
  }, [setCurrentRoom, conferenceServer]);

  return { wasAutoSelected };
};
