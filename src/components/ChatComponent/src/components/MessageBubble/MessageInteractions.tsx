import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
  ContextMenu,
  Delimeter,
  MenuItem,
  Overlay,
} from '../ContextMenu/ContextMenuComponents';
import {useDispatch, useSelector} from 'react-redux';
import {RootState} from '../../roomStore';
import {
  MESSAGE_INTERACTIONS,
  MESSAGE_INTERACTIONS_ICONS,
} from '../../helpers/constants/MESSAGE_INTERACTIONS';
import {IMessage} from '../../types/types';
import {useXmppClient} from '../../context/xmppProvider';
import {setActiveMessage} from '../../roomStore/roomsSlice';
import {
  Alert,
  Modal,
  Text,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  Animated,
} from 'react-native';
import Toast from '../Toast/Toast';

interface MessageInteractionsProps {
  isReply?: boolean;
  isUser?: boolean;
  message: IMessage;
  position: {x: number; y: number} | null;
  closeMenu: () => void;
  handleReplyMessage: () => void;
  handleDeleteMessage: () => void;
  handleEditMessage: () => void;
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
}) => {
  const {client} = useXmppClient();
  const dispatch = useDispatch();
  const [toastVisible, setToastVisible] = useState(false);
  const [isPositionReady, setIsPositionReady] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;
  // const handleDeleteMessage = (roomJid: string, messageId: string) => {
  //   // dispatch(deleteRoomMessage({ roomJID: room, messageId: msgId }));
  //   client.deleteMessageStanza(roomJid, messageId);
  // };

  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config,
  );

  const closeContextMenu = () => {
    // if (!config?.disableInteractions) {
    //   setContextMenu({ visible: false, x: 0, y: 0 });
    // }
  };

  const handleCopyMessage = (text: string) => {
    setToastVisible(true);
    setTimeout(() => setToastVisible(false), 2000);
  };

  const handleReplyMessage = () => {
    replyMessage();
  };

  const memoPosition = useMemo(() => {
    if (position && !isNaN(position.y) && position.y >= 0) {
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
    return { top: 100, left: 10 };
  }, [position, isUser]);

  useEffect(() => {
    if (position) {
      setIsPositionReady(true);
    }
  }, [position]);

  useEffect(() => {
    if (isPositionReady) {
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [isPositionReady]);

  if (config?.disableInteractions) return null;

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={closeMenu}>
      {!message.isDeleted && isPositionReady && (
        <Overlay onPress={closeMenu}>
          <ContextMenu
            style={[styles.contextMenu,
              {
                top: memoPosition?.top ? Math.min(memoPosition.top, Dimensions.get('window').height - 150) : 0,
                left: memoPosition?.left || '',
                right: memoPosition?.right || '',
              },
            ]}
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

      <Toast
        visible={toastVisible}
        message="Copied to clipboard!"
        duration={1500}
      />
    </Modal>
  );
};

export default MessageInteractions;

const styles = StyleSheet.create({
  overlay: {
  },
  contextMenu: {
    position: 'absolute',
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
