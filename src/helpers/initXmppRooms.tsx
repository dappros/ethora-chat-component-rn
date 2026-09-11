import { setCurrentRoom, setIsLoading } from '../roomStore/roomsSlice';
import { initRoomsPresence } from './initRoomsPresence';
import XmppClient from '../networking/xmppClient';
import { IConfig, IRoom, User } from '../types/types';
import { store } from '../roomStore';
import { refreshAuthTokensQuietly } from '../networking/authRefresh';

const initXmppRooms = async (
  user: User,
  config: IConfig,
  xmmpClient: XmppClient,
  rooms?: { [key: string]: IRoom },
  roomJID?: string
) => {
  if (roomJID) {
    store.dispatch(setCurrentRoom({ roomJID: roomJID }));
  }

  try {
    if (!user.defaultWallet || !user.defaultWallet.walletAddress) {
      console.log('Error, no user');
      return;
    }

    if (!xmmpClient) {
      console.log('No xmmpClient, initializing one');

      if (rooms && Object.keys(rooms).length > 0) {
        await initRoomsPresence(xmmpClient, rooms);
      } else {
        if (config?.newArch) {
          // const rooms = await getRooms();
          //     rooms.items.map((room) => {
          //       dispatch(
          //         addRoomViaApi({
          //           room: createRoomFromApi(
          //             room,
          //             config?.xmppSettings?.conference
          //           ),
          //           xmpp: newClient,
          //         })
          //       );
          //     });
          return;
        }
        const res = await (xmmpClient as any as XmppClient).getRoomsStanza();
        console.log(res);
      }

      // getChatsPrivateStoreRequestStanza hydrates redux itself
      // (dispatch(applyPrivateStoreMarkers(...)) internally, clamped +
      // forward-only) - do not also apply the raw return value here. That
      // used to double-dispatch via updatedChatLastTimestamps' unconditional
      // setLastViewedTimestamp, which has neither the forward-only guard
      // nor the future-marker clamp, so it could silently re-clobber a
      // value the clamp had just corrected (bug #38).
      await (xmmpClient as any as XmppClient).getChatsPrivateStoreRequestStanza();
    } else {
      await xmmpClient.getChatsPrivateStoreRequestStanza();
    }

    if (config?.refreshTokens?.enabled) {
      // Was a bare call to the consumer-supplied refreshFunction, i.e. a
      // rotation completely outside the SDK's lock. Routed through the
      // one rotation point, which calls that same function internally.
      refreshAuthTokensQuietly();
    }
  } catch (error) {
    console.error(error);
  } finally {
    store.dispatch(setIsLoading({ loading: false }));
  }
};

export default initXmppRooms;
