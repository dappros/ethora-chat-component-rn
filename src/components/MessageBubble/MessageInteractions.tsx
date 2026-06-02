import React, { useEffect, useId, useMemo, useState } from 'react';
import { Delimeter, MenuItem } from '../ContextMenu/ContextMenuComponents';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import {
  MESSAGE_INTERACTIONS,
  MESSAGE_INTERACTIONS_ICONS,
} from '../../helpers/constants/MESSAGE_INTERACTIONS';
import { IMessage } from '../../types/types';
import {
  Text,
  StyleSheet,
  View,
  Pressable,
  Dimensions,
  Keyboard,
  type LayoutChangeEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useToast } from '../../context/ToastContext';
import { useInteractionsOverlay } from './InteractionsOverlay';

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
  const { present, dismiss, originX, originY } = useInteractionsOverlay();
  const overlayId = useId();

  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });

  // Live keyboard height so the menu knows the REAL space below the message.
  // Without this the position math used the full screen height and happily
  // opened the menu downward into the area the keyboard now covers, hiding
  // it under the keyboard / behind the input. Seeded from current metrics so
  // an already-open keyboard (the common case: menu opened while typing) is
  // accounted for on first render, not only after the next show event.
  const [keyboardHeight, setKeyboardHeight] = useState(
    () => Keyboard.metrics?.()?.height ?? 0
  );

  useEffect(() => {
    const onShow = (e: any) =>
      setKeyboardHeight(e?.endCoordinates?.height ?? 0);
    const onHide = () => setKeyboardHeight(0);
    const subs = [
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidChangeFrame', onShow),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

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

    // The keyboard occludes the bottom `keyboardHeight` px, so the real
    // visible bottom edge is above it. Measuring space below against this
    // (not the full screen) is what makes the menu flip ABOVE the message
    // when the keyboard is open and the message sits near the input.
    const visibleBottom = screenHeight - keyboardHeight;

    const spaceBelow = visibleBottom - position.bottom - bottomReserve;
    const spaceAbove = position.top - topReserve;

    let top: number;
    if (spaceBelow >= menuSize.height) {
      top = position.bottom;
    } else if (spaceAbove >= menuSize.height) {
      top = position.top - menuSize.height;
    } else {
      top = Math.max(
        topReserve,
        visibleBottom - menuSize.height - bottomReserve
      );
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
  }, [position, menuSize, config?.keyboardVerticalOffset, keyboardHeight]);

  // Window coords (memoPosition) → host-local coords. The overlay host
  // sits below the status bar / header, so subtract its measured origin.
  const localPosition = useMemo(() => {
    if (!memoPosition) {return undefined;}
    return {
      ...memoPosition,
      top: (memoPosition as { top: number }).top - originY,
      left: (memoPosition as { left: number }).left - originX,
    };
  }, [memoPosition, originX, originY]);

  const content =
    config?.disableInteractions || message.isDeleted ? null : (
      <View style={styles.overlayFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeMenu} />
        <View
          style={[styles.contextMenu, localPosition]}
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
    );

  // Render the menu in the in-tree overlay host instead of a React Native
  // <Modal>. A Modal opens its own window on Android, which steals focus
  // from the chat input and dismisses the keyboard when the menu opens;
  // hosting it in the same view tree keeps the keyboard up. Re-run every
  // render so menuSize/position updates refresh the hosted node.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (content) {
      present(overlayId, content);
    } else {
      dismiss(overlayId);
    }
  });
  useEffect(() => () => dismiss(overlayId), [dismiss, overlayId]);

  return null;
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
