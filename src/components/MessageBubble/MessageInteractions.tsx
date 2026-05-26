import React, { useMemo } from 'react';
import { Delimeter, MenuItem } from '../ContextMenu/ContextMenuComponents';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import {
  MESSAGE_INTERACTIONS,
  MESSAGE_INTERACTIONS_ICONS,
} from '../../helpers/constants/MESSAGE_INTERACTIONS';
import { IMessage } from '../../types/types';
import {
  Modal,
  Text,
  StyleSheet,
  View,
  Pressable,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../context/ToastContext';

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
}) => {
  const { showToast } = useToast();

  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const handleCopyMessage = async (text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: 'Copied to clipboard!',
        type: 'success',
      });
    } catch (err) {
      console.log(err);
      showToast({
        id: Date.now().toString(),
        title: 'Copy failed',
        message: (err as Error)?.message || 'Unknown error',
        type: 'error',
      });
    }
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

  if (config?.disableInteractions) {return null;}

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={closeMenu}
    >
      {!message.isDeleted && (
        <View style={styles.overlayFill}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
          <View style={[styles.contextMenu, memoPosition]}>
            <MenuItem onPress={() => handleCopyMessage(message.body!)}>
              <Text>{MESSAGE_INTERACTIONS.COPY}</Text>
              <MESSAGE_INTERACTIONS_ICONS.COPY />
            </MenuItem>
            {isUser && (
              <>
                <Delimeter />
                <MenuItem onPress={handleEditMessage}>
                  <Text>{MESSAGE_INTERACTIONS.EDIT}</Text>
                  <MESSAGE_INTERACTIONS_ICONS.EDIT />
                </MenuItem>
                <Delimeter />
                <MenuItem onPress={handleDeleteMessage}>
                  <Text>{MESSAGE_INTERACTIONS.DELETE}</Text>
                  <MESSAGE_INTERACTIONS_ICONS.DELETE />
                </MenuItem>
              </>
            )}
          </View>
        </View>
      )}

    </Modal>
  );
};

export default MessageInteractions;

const styles = StyleSheet.create({
  overlayFill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  contextMenu: {
    position: 'absolute',
    backgroundColor: 'white',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    minWidth: 180,
  },
});
