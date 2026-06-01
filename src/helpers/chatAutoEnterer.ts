/** @format */

import { AppDispatch } from '../roomStore';
import { setCurrentRoom } from '../roomStore/roomsSlice';
import { normalizeRoomJid } from './normalizeRoomJid';

interface XmppConfig {
  xmppSettings?: {
    conference?: string;
  };
}

interface SelectRoomArgs {
  roomJID?: string | null;
  wasAutoSelected: boolean;
  config: XmppConfig;
  dispatch: AppDispatch;
}

export const chatAutoEnterer = ({
  roomJID,
  wasAutoSelected,
  config,
  dispatch,
}: SelectRoomArgs): void => {
  console.log('🟡 chatAutoEnterer: Called', { roomJID, wasAutoSelected });

  if (roomJID) {
    const conferenceDomain = config.xmppSettings?.conference ?? '';
    const finalRoomJID = normalizeRoomJid(roomJID, conferenceDomain);

    console.log('🟡 chatAutoEnterer: Setting current room', finalRoomJID);
    dispatch(setCurrentRoom({ roomJID: finalRoomJID }));
    return;
  }

  console.log('🟡 chatAutoEnterer: No roomJID provided');
  // In React Native, we don't have window.location.search
  // The roomJID should be passed directly via props/config
};
