import { useEffect, useState } from "react";
import { AppState } from "react-native";
import XmppClient from "../networking/xmppClient";
import { IRoom } from "../types/types";
import { useDispatch } from "react-redux";
import { setLastViewedTimestamp } from "../roomStore/roomsSlice";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface UseAppStateProps {
  client: XmppClient;
  roomsList: { [jid: string]: IRoom };
  activeRoomJID: string | null;
}

const useAppState = (props: UseAppStateProps) => {
  const { client, roomsList = {}, activeRoomJID } = props;
  const dispatch = useDispatch();

  const handleTimestamp = async () => {
    if (client && roomsList) {
      const timestamp = new Date().getTime();
      client.actionSetTimestampToPrivateStoreStanza(
        activeRoomJID || "",
        timestamp,
        Object.keys(roomsList)
      );

      dispatch(
        setLastViewedTimestamp({
          chatJID: activeRoomJID || "",
          timestamp,
        })
      );

      await AsyncStorage.setItem(
        "lastViewedTimestamp",
        JSON.stringify({
          chatJID: activeRoomJID || "",
          timestamp,
        })
      );
    }
  };

  useEffect(() => {
    const handleAppStateChange = async (nextAppState) => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        handleTimestamp();
        await AsyncStorage.setItem(
          "lastAppState",
          JSON.stringify(nextAppState)
        );
      } else if (nextAppState === "active") {
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID || "",
            timestamp: 0,
          })
        );
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      subscription.remove();
    };
  }, [client, roomsList, activeRoomJID]);
};

export default useAppState;
