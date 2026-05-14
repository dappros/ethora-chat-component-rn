// /**
//  * Push Notification Provider
//  * Initializes and manages push notifications for the chat
//  */

// import React, { createContext, useContext, useEffect, ReactNode } from 'react';
// import { useSelector, useDispatch } from 'react-redux';
// import { usePushNotifications } from '../hooks/usePushNotifications';
// import { RootState } from '../roomStore';
// import { setCurrentRoom } from '../roomStore/roomsSlice';
// import { IConfig } from '../types/types';

// interface PushNotificationContextType {
//   fcmToken: string | null;
//   isInitialized: boolean;
//   error: string | null;
// }

// const PushNotificationContext = createContext<PushNotificationContextType>({
//   fcmToken: null,
//   isInitialized: false,
//   error: null,
// });

// interface PushNotificationProviderProps {
//   children: ReactNode;
//   config?: IConfig;
// }

// export const PushNotificationProvider: React.FC<PushNotificationProviderProps> = ({
//   children,
//   config,
// }) => {
//   const dispatch = useDispatch();
//   const rooms = useSelector((state: RootState) => state.rooms.rooms);

//   // Handle notification press - navigate to chat
//   const handleNotificationPress = (data: any) => {
//     console.log('[PushProvider] Notification pressed:', data);
    
//     if (data?.chatJid) {
//       // Find the room and set it as current
//       const room = rooms.find((r) => r.jid === data.chatJid);
//       if (room) {
//         dispatch(setCurrentRoom({ roomJID: room.jid }));
//       }
//     }

//     // Call custom handler if provided
//     config?.pushNotifications?.onNotificationPress?.(data);
//   };

//   const { fcmToken, isInitialized, error } = usePushNotifications({
//     enabled: config?.pushNotifications?.enabled ?? false,
//     pushApiUrl: config?.pushNotifications?.pushApiUrl,
//     onNotificationPress: handleNotificationPress,
//   });

//   useEffect(() => {
//     if (isInitialized) {
//       console.log('[PushProvider] Push notifications initialized');
//     }
//     if (error) {
//       console.error('[PushProvider] Push error:', error);
//     }
//   }, [isInitialized, error]);

//   return (
//     <PushNotificationContext.Provider value={{ fcmToken, isInitialized, error }}>
//       {children}
//     </PushNotificationContext.Provider>
//   );
// };

// export const usePushNotificationContext = () => useContext(PushNotificationContext);

// export default PushNotificationProvider;

