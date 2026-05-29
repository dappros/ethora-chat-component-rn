import React, { useMemo, useState } from 'react';
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
  Dimensions,
  type LayoutChangeEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../context/ToastContext';

interface MessageInteractionsProps {
  isReply?: boolean;
  isUser?: boolean;
  message: IMessage;
  position: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null;
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

  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });

  const handleMenuLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (
      width &&
      height &&
      (width !== menuSize.width || height !== menuSize.height)
    ) {
      setMenuSize({ width, height });
    }
  };

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
    if (!position) {
      return undefined;
    }

    if (!menuSize.width || !menuSize.height) {
      return { top: position.bottom, left: position.left, opacity: 0 };
    }

    const { width: screenWidth, height: screenHeight } =
      Dimensions.get('window');
    const bottomReserve = (config?.keyboardVerticalOffset ?? 0) + 24;
    const topReserve = 16;
    const sideMargin = 8;

    const spaceBelow = screenHeight - position.bottom - bottomReserve;
    const spaceAbove = position.top - topReserve;

    let top: number;
    if (spaceBelow >= menuSize.height) {
      top = position.bottom;
    } else if (spaceAbove >= menuSize.height) {
      top = position.top - menuSize.height;
    } else {
      top = Math.max(topReserve, screenHeight - menuSize.height - bottomReserve);
    }

    const leftMargin = position.left;
    const rightMargin = screenWidth - position.right;
    const rightAligned = rightMargin < leftMargin;

    let left = rightAligned ? position.right - menuSize.width : position.left;
    left = Math.max(
      sideMargin,
      Math.min(left, screenWidth - menuSize.width - sideMargin)
    );

    return { top, left };
  }, [position, menuSize, config?.keyboardVerticalOffset]);

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
          <View
            style={[styles.contextMenu, memoPosition]}
            onLayout={handleMenuLayout}
          >
            <MenuItem onPress={() => handleCopyMessage(message.body!)}>
              <Text style={styles.menuText}>{MESSAGE_INTERACTIONS.COPY}</Text>
              <MESSAGE_INTERACTIONS_ICONS.COPY />
            </MenuItem>
            {isUser && (
              <>
                {/* Edit only for non-media messages (upstream guard) +
                    consistent label styling (menuText). */}
                {message?.isMediafile !== 'true' && (
                  <>
                    <Delimeter />
                    <MenuItem onPress={handleEditMessage}>
                      <Text style={styles.menuText}>
                        {MESSAGE_INTERACTIONS.EDIT}
                      </Text>
                      <MESSAGE_INTERACTIONS_ICONS.EDIT />
                    </MenuItem>
                  </>
                )}
                <Delimeter />
                <MenuItem onPress={handleDeleteMessage}>
                  <Text style={styles.menuText}>{MESSAGE_INTERACTIONS.DELETE}</Text>
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
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
    minWidth: 180,
    // Clip the children to the rounded corners (the hairline dividers
    // run full width; without this they'd poke past the rounding on
    // Android).
    overflow: 'hidden',
  },
  // Explicit label styling so rows are the same height on both platforms
  // — Android's default includeFontPadding made the menu rows taller and
  // misaligned vs iOS. marginRight keeps the label off the trailing icon.
  menuText: {
    fontSize: 16,
    color: '#141414',
    includeFontPadding: false,
    textAlignVertical: 'center',
    marginRight: 16,
  },
});
