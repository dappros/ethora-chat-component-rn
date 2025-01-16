import { FC, useCallback, useEffect, useRef, useState } from "react";
import { IMessage, User } from "../../types/types";
import {
  AlsoCheckbox,
  AlsoContainer,
  ChatContainer,
  ThreadContainer,
} from "../styled/StyledComponents";
import SendInput from "../styled/SendInput";
import { useDispatch } from "react-redux";
import { useXmppClient } from "../../context/xmppProvider";
import MessageList from "../MainComponents/MessageList";
import ModalHeaderComponent from "../Modals/ModalHeaderComponent";
import {
  setCloseActiveMessage,
  setEditAction,
} from "../../roomStore/roomsSlice";
import { EditWrapper } from "../MainComponents/EditWrapper";
import { useSendMessage } from "../../hooks/useSendMessage";
import { createMainMessageForThread } from "../../helpers/createMainMessageForThread";
import { useRoomState } from "../../hooks/useRoomState";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import {
  Animated,
  Text,
  TouchableOpacity,
  StyleSheet,
  PanResponder,
} from "react-native";

interface ThreadWrapperProps {
  activeMessage: IMessage;
  user: User;
  customMessageComponent?: React.ComponentType<{
    message: IMessage;
    isUser: boolean;
    isReply: boolean;
  }>;
}

const ThreadWrapper: FC<ThreadWrapperProps> = ({
  activeMessage,
  user,
  customMessageComponent: CustomMessageComponent,
}) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();

  const { loading, globalLoading, roomsList, editAction } = useRoomState();
  const { config } = useChatSettingState();
  const { sendMessage: sendMs, sendMedia: sendMessageMedia } = useSendMessage();

  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [isChecked, setIsChecked] = useState<boolean>(false);

  const slideAnim = useRef(new Animated.Value(300)).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (e, gestureState) => {
        return gestureState.x0 <= 100;
      },
      onMoveShouldSetPanResponder: (e, gestureState) => {
        return gestureState.x0 <= 100 && gestureState.dx > 0;
      },
      onPanResponderMove: (e, gestureState) => {
        if (gestureState.x0 <= 100 && gestureState.dx > 0) {
          slideAnim.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (e, gestureState) => {
        if (gestureState.x0 <= 100 && gestureState.dx > 150) {
          closeThread();
        } else {
          Animated.spring(slideAnim, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const loadMoreMessages = useCallback(
    async (chatJID: string, max: number, idOfMessageBefore?: number) => {
      if (!isLoadingMore) {
        setIsLoadingMore(true);
        client?.getHistoryStanza(chatJID, max, idOfMessageBefore).then(() => {
          setIsLoadingMore(false);
        });
      }
    },
    [client]
  );

  const sendMessage = useCallback(
    (message: string) => {
      sendMs(
        message,
        activeMessage.roomJid,
        true,
        isChecked,
        createMainMessageForThread(activeMessage)
      );
    },
    [activeMessage]
  );

  const sendMedia = useCallback(
    (data: any, type: string) => {
      sendMessageMedia(
        data,
        type,
        activeMessage.roomJid,
        true,
        true,
        createMainMessageForThread(activeMessage)
      );
    },
    [activeMessage]
  );

  const sendStartComposing = useCallback(() => {
    client.sendTypingRequestStanza(
      activeMessage.roomJid,
      `${user.firstName} ${user.lastName}`,
      true
    );
  }, []);

  const sendEndComposing = useCallback(() => {
    client.sendTypingRequestStanza(
      activeMessage.roomJid,
      `${user.firstName} ${user.lastName}`,
      false
    );
  }, []);

  const onCloseEdit = () => {
    dispatch(setEditAction({ isEdit: false }));
  };

  const closeThread = () => {
    dispatch(setCloseActiveMessage({ chatJID: activeMessage.roomJid }));
    dispatch(setEditAction({ isEdit: false }));
  };

  useEffect(() => {
    if (activeMessage?.activeMessage) {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [activeMessage?.activeMessage]);

  return (
    <Animated.View
      {...panResponder.panHandlers}
      style={[
        styles.threadContainer,
        { transform: [{ translateX: slideAnim }] },
        // ...config?.chatRoomStyles,
      ]}
    >
      <ModalHeaderComponent
        headerTitle="Thread"
        handleCloseModal={closeThread}
      />
      <MessageList
        loadMoreMessages={loadMoreMessages}
        CustomMessage={CustomMessageComponent}
        user={user}
        roomJID={activeMessage.roomJid}
        config={config}
        loading={isLoadingMore}
        activeMessage={activeMessage}
        isReply
      />
      <AlsoContainer onPress={() => setIsChecked((prev) => !prev)}>
        <AlsoCheckbox
          accentColor={
            isChecked ? config?.colors?.primary || "#0052CD" : "#fff"
          }
          // checked={isChecked}
          onPress={() => setIsChecked(!isChecked)}
        />
        <Text>Also send to</Text>
        <TouchableOpacity onPress={closeThread}>
          <Text
            style={{
              color: config?.colors?.primary || "#0052CD",
              fontWeight: 500,
            }}
          >
            {roomsList[activeMessage.roomJid].name}
          </Text>
        </TouchableOpacity>
      </AlsoContainer>
      {editAction.isEdit && (
        <EditWrapper text={editAction.text || ""} onClose={onCloseEdit} />
      )}
      <SendInput
        editMessage={editAction.text}
        sendMedia={sendMedia}
        sendMessage={sendMessage}
        config={config}
        onFocus={sendStartComposing}
        onBlur={sendEndComposing}
        isLoading={loading}
      />
    </Animated.View>
  );
};

export default ThreadWrapper;

const styles = StyleSheet.create({
  threadContainer: {
    zIndex: 999,
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "#f3f6fc",
    flexDirection: "column",
    justifyContent: "space-between",
    flex: 1,
  },
  text: {
    color: "#fff",
    fontSize: 18,
  },
});
