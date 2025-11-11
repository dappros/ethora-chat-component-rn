/** @format */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChatContainer, NonRoomChat } from "../styled/StyledComponents";
import { useDispatch } from "react-redux";
import MessageList from "./MessageList";
import SendInput from "../styled/SendInput";
import {
  deleteRoomMessage,
  setEditAction,
  setLastViewedTimestamp,
} from "../../roomStore/roomsSlice";
import Loader from "../styled/Loader";
import { useXmppClient } from "../../context/xmppProvider";
import ChatHeader from "./ChatHeader";
import NoMessagesPlaceholder from "./NoMessagesPlaceholder";
import NewChatModal from "../Modals/NewChatModal/NewChatModal";
import { EditWrapper } from "./EditWrapper";
import { NoSelectedChatIcon } from "../../assets/icons";
import { ChooseChatMessage } from "./ChooseChatMessage";
import { useRoomUrl } from "../../hooks/useRoomUrl";
import { useSendMessage } from "../../hooks/useSendMessage";
import { useRoomInitialization } from "../../hooks/useRoomInitialization";
import { useRoomState } from "../../hooks/useRoomState";
import { useChatSettingState } from "../../hooks/useChatSettingState";
import CustomTypingIndicator from '../styled/StyledInputComponents/CustomTypingIndicator';
// import {PanGestureHandler} from 'react-native-gesture-handler';
import { FlatList } from "react-native";
import {
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import useComposing from "../../hooks/useComposing";

interface ChatRoomProps {
  CustomMessageComponent?: any;
  handleBackClick?: (value: boolean) => void;
}

const ChatRoom: React.FC<ChatRoomProps> = React.memo(
  ({ CustomMessageComponent, handleBackClick }) => {
    const { client } = useXmppClient();
    const dispatch = useDispatch();

    const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);

    const { user, config } = useChatSettingState();
    const {
      roomsList,
      activeRoomJID,
      editAction,
      loading,
      globalLoading,
      roomMessages,
    } = useRoomState();
    const {
      sendMessage: sendMs,
      sendMedia: sendMessageMedia,
      sendEditMessage,
      isLastMessageFromUserAndProcessing,
    } = useSendMessage();
    const { sendStartComposing, sendEndComposing } = useComposing(config);
    
    const sendMessage = useCallback(
      (message: string) => {
        if(!activeRoomJID) {
          return;
        }
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID,
            timestamp: 0,
          })
        );
        sendMs(message, activeRoomJID);
      },
      [activeRoomJID]
    );

    const sendMedia = useCallback(
      (data: any, type: string) => {
        sendMessageMedia(data, type, activeRoomJID || "");
      },
      [activeRoomJID]
    );

    const loadMoreMessages = useCallback(
      async (chatJID: string, max: number, idOfMessageBefore?: number) => {
        if (!isLoadingMore && !roomsList?.[chatJID]?.historyComplete) {
          const lastMsgId =
            typeof idOfMessageBefore !== 'string'
              ? idOfMessageBefore
              : Number(
                  roomsList[chatJID].messages[
                    roomsList[chatJID].messages.length - 2
                  ].id
                );
          setIsLoadingMore(true);
          client?.getHistoryStanza(chatJID, max, lastMsgId).then(() => {
            setIsLoadingMore(false);
          });
        }
      },
      [client?.client?.jid]
    );

    const onCloseEdit = () => {
      dispatch(setEditAction({ isEdit: false }));
    };

    useEffect(() => {
      if(!activeRoomJID) {
        return;
      };

      dispatch(
        setLastViewedTimestamp({
          chatJID: activeRoomJID,
          timestamp: 0,
        })
      );
      setIsLoadingMore(false);
      return () => {
        

        if (client) {
          client.actionSetTimestampToPrivateStoreStanza(
            activeRoomJID,
            new Date().getTime(),
            Object.keys(roomsList)
          );
        }
        dispatch(
          setLastViewedTimestamp({
            chatJID: activeRoomJID,
            timestamp: new Date().getTime(),
          })
        );
        dispatch(
          deleteRoomMessage({
            roomJID: activeRoomJID,
            messageId: 'delimiter-new',
          })
        );
        setIsLoadingMore(false);
      };
    }, [activeRoomJID]);

    // hooks useEffects
    // useRoomUrl(activeRoomJID || "", roomsList, config);

    console.log("ChatRoom render", {
      activeRoomJID,
      roomsList,
      config,
      roomMessages});

    useRoomInitialization(
      activeRoomJID || "",
      roomsList,
      config,
      roomMessages.length,
    );

    if (Object.keys(roomsList)?.length < 1 && !loading && !globalLoading) {
      return (
        <NonRoomChat>
          {/* <Text>No room. Let's create one!</Text> */}
          <NewChatModal />
        </NonRoomChat>
      );
    }

    if (!activeRoomJID || !roomsList?.[activeRoomJID]) {
      return <ChooseChatMessage />;
    }

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 42 : 0}
      >
        <ChatContainer
          style={
            config?.chatRoomStyles
              ? (config.chatRoomStyles as import('react-native').ViewStyle)
              : undefined
          }
        >
          {!config?.disableHeader && (
            <ChatHeader
              currentRoom={roomsList[activeRoomJID]}
              handleBackClick={handleBackClick}
            />
          )}
          {config?.chatHeaderAdditional?.enabled &&
          config.chatHeaderAdditional.element()}
          {loading || globalLoading ? (
            <Loader color={config?.colors?.primary} />
          ) : Object.keys(roomsList).length < 1 || !activeRoomJID ? (
            <NoSelectedChatIcon />
          ) : roomMessages && roomMessages.length < 1 ? (
            <NoMessagesPlaceholder />
          ) : (
            <MessageList
              loadMoreMessages={loadMoreMessages}
              CustomMessage={CustomMessageComponent}
              user={user}
              roomJID={activeRoomJID}
              config={config}
              loading={isLoadingMore}
              isReply={false}
            />
          )}
          {editAction && editAction.isEdit && (
            <EditWrapper text={editAction.text || ""} onClose={onCloseEdit} />
          )}
          <SendInput
            editMessage={editAction && editAction.text}
            sendMessage={editAction &&editAction.isEdit ? sendEditMessage : sendMessage}
            sendMedia={sendMedia}
            config={config}
            isLoading={loading}
            onFocus={sendStartComposing}
            onBlur={sendEndComposing}
            isMessageProcessing={isLastMessageFromUserAndProcessing(
              activeRoomJID
            )}
          />

          {config?.customTypingIndicator?.enabled &&
            (config.customTypingIndicator.position === 'overlay' ||
              config.customTypingIndicator.position === 'floating') &&
                roomsList[activeRoomJID]?.composing && (
                  <CustomTypingIndicator
                    usersTyping={roomsList[activeRoomJID]?.composingList || ['User']}
                    text={config.customTypingIndicator.text}
                    position={config.customTypingIndicator.position}
                    styles={config.customTypingIndicator.styles}
                    customComponent={config.customTypingIndicator.customComponent}
                    isVisible={roomsList[activeRoomJID]?.composing || false}
                  />
          )}
        </ChatContainer>
      </KeyboardAvoidingView>
    );
  }
);

export default ChatRoom;
