import XmppClient from '../networking/xmppClient';
import { store } from '../roomStore';
import { setRoomMessages } from '../roomStore/roomsSlice';
import { IMessage, IRoom } from '../types/types';
import { checkUniqueUsers } from './checkUniqueUsers';

// BUGFIX: previously this module imported `getLastMessageTimestamp`
// + `insertUsers` from roomsSlice — neither exists in the slice, so
// any caller (useChatWrapperInit) crashed at runtime with
// "getLastMessageTimestamp is not a function" the first time the
// reducer was hit. Replaced the lookup with an inline read of
// `room.lastMessageTimestamp`; the dead `insertUsers` dispatch was
// dropped (no action exists to receive it).

export const updateMessagesTillLast = async (
  rooms: {
    [jid: string]: IRoom;
  },
  client: XmppClient,
  batchSize = 5,
  maxFetchAttempts = 4,
  messagesPerFetch = 5
) => {
  const roomEntries = Object.keys(rooms);
  if (roomEntries.length > 0) {
    let processedIndex = 0;

    while (processedIndex < roomEntries.length) {
      const currentBatch = roomEntries.slice(
        processedIndex,
        processedIndex + batchSize
      );

      const lastTimestampsByJid = currentBatch.reduce(
        (acc: Record<string, number>, current: string) => {
          const room = (store.getState() as any).rooms?.rooms?.[current];
          acc[current] = Number(room?.lastMessageTimestamp ?? 0) || 0;
          return acc;
        },
        {} as Record<string, number>
      );

      await Promise.all(
        currentBatch.map(async (jid, index) => {
          try {
            if (index > 0) {await new Promise((res) => setTimeout(res, 125));}

            let counter = 0;
            let isMessageFound = false;
            let currentJidNewMessages: IMessage[] = [];

            const lastCachedMessagesTimeStamp = lastTimestampsByJid[jid];
            if (!lastCachedMessagesTimeStamp) {return;}

            while (!isMessageFound && counter < maxFetchAttempts) {
              const lastMessageId =
                counter > 0 ? currentJidNewMessages[0]?.id : undefined;

              const fetchedMessages = await client.getHistoryStanza(
                jid,
                messagesPerFetch,
                Number(lastMessageId)
              );

              if (!fetchedMessages.length) {break;}

              counter++;

              currentJidNewMessages = [
                ...fetchedMessages,
                ...currentJidNewMessages,
              ];

              isMessageFound = currentJidNewMessages.some(
                (message: IMessage) =>
                  Number(message.id) === Number(lastCachedMessagesTimeStamp)
              );

              if (!isMessageFound && !(counter <= maxFetchAttempts - 1)) {
                // Fire-and-forget — checkUniqueUsers resolves to an
                // updated RoomMember list, but there's no slice
                // action wired to receive it on RN yet (the web SDK
                // has one; the port left a TODO). Keep the call so
                // the API request goes out (it warms the cache for
                // later renders) but stop short of dispatching.
                await checkUniqueUsers(currentJidNewMessages);

                store.dispatch(
                  setRoomMessages({
                    roomJID: jid,
                    messages: currentJidNewMessages,
                  })
                );
              }
            }
          } catch (error) {
            console.error(`Error processing room ${jid}:`, error);
          }
        })
      );

      processedIndex += batchSize;
    }
  }

  console.log('All rooms processed');
};
