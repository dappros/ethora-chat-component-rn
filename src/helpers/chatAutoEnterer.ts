/** @format */

import { AppDispatch } from "../roomStore";
import { setCurrentRoom } from "../roomStore/roomsSlice";

interface XmppConfig {
  xmppSettings?: {
    conference?: string;
  };
}

interface SelectRoomArgs {
  roomJID?: string;
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
  console.log("🟡 chatAutoEnterer: Called", { roomJID, wasAutoSelected });

  if (roomJID) {
    // If roomJID is already a full JID, use it directly
    // Otherwise, construct it from chatId if needed
    const conferenceDomain = config.xmppSettings?.conference ?? "";
    let finalRoomJID = roomJID;

    if (!roomJID.includes("@") && conferenceDomain) {
      finalRoomJID = `${roomJID}@${conferenceDomain}`;
      console.log("🟡 chatAutoEnterer: Constructed roomJID", finalRoomJID);
    }

    console.log("🟡 chatAutoEnterer: Setting current room", finalRoomJID);
    dispatch(setCurrentRoom({ roomJID: finalRoomJID }));
    return;
  }

  console.log("🟡 chatAutoEnterer: No roomJID provided");
  // In React Native, we don't have window.location.search
  // The roomJID should be passed directly via props/config
};
