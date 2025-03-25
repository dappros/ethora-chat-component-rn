import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setCurrentRoom } from "../roomStore/roomsSlice";
import { IConfig, IRoom } from "../types/types";

export const useRoomUrl = (
  activeRoomJID: string,
  roomsList: Record<string, IRoom>,
  config: IConfig | undefined
) => {
  const dispatch = useDispatch();

  useEffect(() => {
    if (config?.setRoomJidInPath && activeRoomJID) {
      const chatJidUrl = activeRoomJID.split("@")[0];
    } else if (!activeRoomJID && Object.values(roomsList).length > 0) {
      dispatch(setCurrentRoom({ roomJID: roomsList[0]?.jid }));
    }

    return () => {
      if (config?.setRoomJidInPath) {
      }
    };
  }, [activeRoomJID, roomsList?.length]);
};
