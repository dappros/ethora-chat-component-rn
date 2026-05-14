import React, { useMemo, useState } from "react";
import {
  ContextMenu,
  Delimeter,
  MenuItem,
  Overlay,
} from "../ContextMenu/ContextMenuComponents";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../roomStore";
import {
  MESSAGE_INTERACTIONS,
  MESSAGE_INTERACTIONS_ICONS,
} from "../../helpers/constants/MESSAGE_INTERACTIONS";
import { IMessage } from "../../types/types";
import { useXmppClient } from "../../context/xmppProvider";
import { setActiveMessage } from "../../roomStore/roomsSlice";
import {
  Alert,
  Modal,
  Text,
  TouchableWithoutFeedback,
  StyleSheet,
  View,
  Pressable,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import { useToast } from "../../context/ToastContext";
import EmojiPicker from "react-native-emoji-selector";

const fixedEmojiIds = ["joy", "heart", "fire", "+1", "smile", "scream"];

function convertIdToEmoji(id: string) {
  const mapping = {
    joy: "😂",
    heart: "❤️",
    fire: "🔥",
    "+1": "👍",
    smile: "😄",
    scream: "😱",
  };
  return mapping[id as keyof typeof mapping] || "❓";
}

interface MessageInteractionsProps {
  isReply?: boolean;
  isUser?: boolean;
  message: IMessage;
  position: { x: number; y: number } | null;
  closeMenu: () => void;
  handleReplyMessage: () => void;
  handleDeleteMessage: () => void;
  handleEditMessage: () => void;
  handleReactionMessage: (id: string) => void;
}

const MessageInteractions: React.FC<MessageInteractionsProps> = ({
  isReply,
  isUser,
  message,
  closeMenu,
  position,
  handleReplyMessage: replyMessage,
  handleDeleteMessage,
  handleEditMessage,
  handleReactionMessage,
}) => {
  const { client } = useXmppClient();
  const dispatch = useDispatch();
  const { showToast } = useToast();

  const [pickerVisible, setPickerVisible] = useState(false);

  const handleReactionClick = (id: string) => {
    handleReactionMessage(id);
    closeMenu();
  };

  const onClose = () => {
    setPickerVisible(false);
  };

  // const handleDeleteMessage = (roomJid: string, messageId: string) => {
  //   // dispatch(deleteRoomMessage({ roomJID: room, messageId: msgId }));
  //   client.deleteMessageStanza(roomJid, messageId);
  // };

  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const closeContextMenu = () => {
    // if (!config?.disableInteractions) {
    //   setContextMenu({ visible: false, x: 0, y: 0 });
    // }
  };

  const handleCopyMessage = (text: string) => {
    Clipboard.setString(text);
    showToast({
      id: Date.now().toString(),
      title: 'Success',
      message: 'Copied to clipboard!',
      type: 'success',
    });
    closeMenu();
  };

  const handleReplyMessage = () => {
    replyMessage();
  };

  const memoPosition = useMemo(() => {
    if (position) {
      if (isUser) {
        return {
          top: position.y,
          right: 10,
        };
      }

      return {
        top: position.y,
        left: 10,
      };
    }
  }, [position, isUser]);

  if (config?.disableInteractions) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={closeMenu}
    >
      {!message.isDeleted && (
        <Overlay onPress={closeMenu}>
          <ContextMenu
            style={[styles.contextMenu, memoPosition]}
            // style={{ top: contextMenu.y, left: contextMenu.x }}
          >
            {/* <MenuItem onClick={() => console.log(MESSAGE_INTERACTIONS.SEND_COINS)}>
            {MESSAGE_INTERACTIONS.SEND_COINS}
            <MESSAGE_INTERACTIONS_ICONS.SEND_COINS />{' '}
          </MenuItem>
          <Delimeter />
          <MenuItem onClick={() => console.log(MESSAGE_INTERACTIONS.SEND_ITEM)}>
            {MESSAGE_INTERACTIONS.SEND_ITEM}
            <MESSAGE_INTERACTIONS_ICONS.SEND_ITEM />{' '}
          </MenuItem> */}
            {/* <Delimeter /> */}
            <View style={{ flexDirection: "row", paddingBottom: 10 }}>
            {fixedEmojiIds.map((id) => (
              <Pressable
                key={id}
                onPress={() => handleReactionClick(id)}
                style={{ marginRight: 6 }}
              >
                <Text style={{ fontSize: 26 }}>{convertIdToEmoji(id)}</Text>
              </Pressable>
            ))}

            {/* ArrowButton */}
            <Pressable
              onPress={() => setPickerVisible(!pickerVisible)}
              style={{ marginLeft: 10 }}
            >
              <Text style={{ fontSize: 24 }}>⌄</Text>
            </Pressable>
          </View>

          {pickerVisible && (
            <View style={{ height: 250 }}>
              <EmojiPicker
                onEmojiSelected={(emoji) => {
                  handleReactionClick(emoji);
                }}
                showSearchBar={false}
                showTabs={false}
              />
            </View>
          )}

            {!isReply && (
              <>
                <MenuItem onPress={handleReplyMessage}>
                  <Text>{MESSAGE_INTERACTIONS.REPLY}</Text>
                  <MESSAGE_INTERACTIONS_ICONS.REPLY />
                </MenuItem>
                <Delimeter />
              </>
            )}
            <MenuItem onPress={() => handleCopyMessage(message.body!)}>
              <Text>{MESSAGE_INTERACTIONS.COPY}</Text>
              <MESSAGE_INTERACTIONS_ICONS.COPY />
            </MenuItem>
            <Delimeter />
            {isUser && (
              <>
                <MenuItem onPress={handleEditMessage}>
                  <Text>{MESSAGE_INTERACTIONS.EDIT}</Text>
                  <MESSAGE_INTERACTIONS_ICONS.EDIT />
                </MenuItem>
                <Delimeter />
              </>
            )}
            <MenuItem onPress={handleDeleteMessage}>
              <Text>{MESSAGE_INTERACTIONS.DELETE}</Text>
              <MESSAGE_INTERACTIONS_ICONS.DELETE />
            </MenuItem>
            {/* <Delimeter />
          <MenuItem onClick={() => console.log(MESSAGE_INTERACTIONS.REPORT)}>
            {MESSAGE_INTERACTIONS.REPORT}
            <MESSAGE_INTERACTIONS_ICONS.REPORT />{' '}
          </MenuItem> */}
          </ContextMenu>
        </Overlay>
      )}

    </Modal>
  );
};

export default MessageInteractions;

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
  },
  contextMenu: {
    position: "absolute",
    backgroundColor: "white",
    padding: 10,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
