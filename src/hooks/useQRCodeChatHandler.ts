import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const QR_CHAT_STORAGE_KEY = '@ethora/chat-component-qrChatId';

export const handleQRChatId = async () => {
  try {
    const initialUrl = await Linking.getInitialURL();

    if (initialUrl) {
      const url = new URL(initialUrl);
      const qrChatId = new URLSearchParams(url.search).get('qrChatId');

      if (qrChatId) {
        await AsyncStorage.setItem(QR_CHAT_STORAGE_KEY, qrChatId);
      }
    }
  } catch (error) {
    console.error('Error handling QR chat ID in RN:', error);
  }
};

export const useQRCodeChat = (
  setCurrentRoom: (params: { roomJID: string }) => void,
  conferenceServer?: string
) => {
  const [wasAutoSelected, setWasAutoSelected] = useState(false);

  useEffect(() => {
    handleQRChatId();
  }, []);

  useEffect(() => {
    const checkStoredQrId = async () => {
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
        console.error('Error using QR chat ID:', error);
      }
    };

    checkStoredQrId();
  }, [setCurrentRoom, conferenceServer]);

  return { wasAutoSelected };
};
