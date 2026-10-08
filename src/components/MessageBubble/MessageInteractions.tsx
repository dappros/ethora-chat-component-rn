import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { canEditMessage } from '../../e2ee';
import { Delimeter, MenuItem } from '../ContextMenu/ContextMenuComponents';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import {
  MESSAGE_INTERACTIONS,
  MESSAGE_INTERACTIONS_ICONS,
} from '../../helpers/constants/MESSAGE_INTERACTIONS';
import { IMessage } from '../../types/types';
import {
  Animated,
  Text,
  StyleSheet,
  View,
  Pressable,
  Dimensions,
  Keyboard,
  type LayoutChangeEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { layoutStack } from './messageMenuLayout';
import { useToast } from '../../context/ToastContext';
import { useInteractionsOverlay } from './InteractionsOverlay';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { getEmojiNativeById } from '../../helpers/emoji';
import {
  quickReactionIds,
  reactionPickerEnabled,
  reactionsEnabled,
} from '../../helpers/reactionsConfig';

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
  /** Opens the full emoji picker (the "+" in the reaction row). */
  onOpenEmojiPicker?: () => void;
  /**
   * A copy of the message bubble, drawn over the dim at the bubble's spot
   * (WhatsApp style): the chat darkens, the message itself does not.
   */
  preview?: React.ReactNode;
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
  onOpenEmojiPicker,
  preview,
}) => {
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { present, dismiss, originX, originY } = useInteractionsOverlay();
  const overlayId = useId();
  const theme = useTheme();
  const themedStyles = useMemo(
    () => ({
      menu: { backgroundColor: theme.surface, shadowColor: theme.shadow },
      text: { color: theme.text },
    }),
    [theme]
  );

  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const [menuSize, setMenuSize] = useState({ width: 0, height: 0 });
  const [barSize, setBarSize] = useState({ width: 0, height: 0 });
  const showReactions = reactionsEnabled(config);
  const quickIds = useMemo(() => quickReactionIds(config), [config]);
  const showPicker = reactionPickerEnabled(config) && !!onOpenEmojiPicker;

  // Entrance: the menu pops out of its anchor (scale + fade) and the chat
  // dims a touch behind it. Started once the menu has been measured and
  // placed — before that it sits invisible at a provisional spot.
  const reveal = useRef(new Animated.Value(0)).current;
  const placed =
    !!position &&
    !!menuSize.width &&
    !!menuSize.height &&
    (!showReactions || !!barSize.height);
  useEffect(() => {
    if (!placed) {
      return;
    }
    Animated.spring(reveal, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 7,
    }).start();
  }, [placed, reveal]);

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

  const handleBarLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width && height && (width !== barSize.width || height !== barSize.height)) {
      setBarSize({ width, height });
    }
  };

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
        title: t('toast.successTitle'),
        message: t('toast.copied'),
        type: 'success',
      });
    } catch (err) {
      console.log(err);
      showToast({
        id: Date.now().toString(),
        title: t('toast.copyFailed'),
        message: (err as Error)?.message || 'Unknown error',
        type: 'error',
      });
    }
    closeMenu();
  };

  const handleReplyMessage = () => {
    replyMessage();
  };

  // Everything below is in WINDOW coordinates until the last step, which
  // turns them into the overlay host's own (it sits below the status bar).
  const { width: screenWidth, height: screenHeight } = Dimensions.get('window');
  const sideMargin = 8;
  const barHeight = showReactions ? barSize.height : 0;

  const stack = useMemo(() => {
    if (!position) {return undefined;}
    // The keyboard covers the bottom `keyboardHeight` px: the stack must
    // fit above it (and above the home indicator).
    const areaBottom =
      screenHeight - Math.max(keyboardHeight, insets.bottom) - 12;
    const areaTop = Math.max(originY, insets.top) + 8;
    return layoutStack({
      bubble: position,
      barHeight,
      menuHeight: menuSize.height,
      areaTop,
      areaBottom,
    });
  }, [position, barHeight, menuSize.height, screenHeight, keyboardHeight, insets.top, insets.bottom, originY]);

  // Bar and menu line up with the bubble's side: the reader's own messages
  // on the right, everybody else's on the left.
  const alignTo = (width: number) => {
    if (!position || !width) {return position?.left ?? 0;}
    const left = isUser ? position.right - width : position.left;
    return Math.max(sideMargin, Math.min(left, screenWidth - width - sideMargin));
  };

  const localPosition = useMemo(() => {
    if (!stack || !position) {return undefined;}
    if (!menuSize.width || !menuSize.height) {
      return { top: position.bottom - originY, left: position.left - originX, opacity: 0 };
    }
    return { top: stack.menuTop - originY, left: alignTo(menuSize.width) - originX };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, position, menuSize, originX, originY, isUser, screenWidth]);

  const localBarPosition = useMemo(() => {
    if (!stack || !position || !showReactions) {return undefined;}
    if (!barSize.width || !barSize.height) {
      return { top: position.top - originY, left: position.left - originX, opacity: 0 };
    }
    return { top: stack.barTop - originY, left: alignTo(barSize.width) - originX };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stack, position, showReactions, barSize, originX, originY, isUser, screenWidth]);

  // The copy of the message starts exactly over the original and glides
  // to its place in the stack once the bar and the menu are measured.
  const previewBox = useMemo(() => {
    if (!stack || !position || !preview) {return undefined;}
    return {
      left: position.left - originX,
      top: stack.previewTop - originY,
      width: position.right - position.left,
      height: stack.previewHeight,
      shift: position.top - stack.previewTop,
    };
  }, [stack, position, preview, originX, originY]);

  const content =
    config?.disableInteractions || message.isDeleted ? null : (
      <View style={styles.overlayFill}>
        <Pressable
          testID="message-menu-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={closeMenu}
        >
          {/* The chat darkens; the message (the copy below) does not. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.dim, { backgroundColor: theme.overlay, opacity: reveal }]}
          />
        </Pressable>
        {previewBox ? (
          <Animated.View
            testID="message-menu-preview"
            pointerEvents="none"
            style={[
              styles.preview,
              {
                left: previewBox.left,
                top: previewBox.top,
                width: previewBox.width,
                maxHeight: previewBox.height,
                transform: [
                  {
                    translateY: reveal.interpolate({
                      inputRange: [0, 1],
                      outputRange: [previewBox.shift, 0],
                      extrapolate: 'clamp',
                    }),
                  },
                  {
                    scale: reveal.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 1.03, 1],
                      extrapolate: 'clamp',
                    }),
                  },
                ],
              },
            ]}
          >
            {preview}
          </Animated.View>
        ) : null}
        {showReactions && (
          <Animated.View
            testID="reaction-bar"
            onLayout={handleBarLayout}
            style={[
              styles.reactionBar,
              { backgroundColor: theme.surface, shadowColor: theme.shadow },
              localBarPosition,
              placed && barSize.height
                ? {
                    opacity: reveal,
                    transform: [
                      {
                        scale: reveal.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.6, 1],
                        }),
                      },
                    ],
                  }
                : null,
            ]}
          >
            {quickIds.map((id) => (
              <Pressable
                key={id}
                testID={`quick-reaction-${id}`}
                onPress={() => {
                  handleReactionMessage(id);
                  closeMenu();
                }}
                style={({ pressed }) => [
                  styles.reactionItem,
                  pressed && { backgroundColor: theme.surfaceHighlight },
                ]}
              >
                <Text style={styles.reactionGlyph}>{getEmojiNativeById(id)}</Text>
              </Pressable>
            ))}
            {showPicker && (
              <Pressable
                testID="quick-reaction-more"
                onPress={() => {
                  closeMenu();
                  onOpenEmojiPicker?.();
                }}
                style={({ pressed }) => [
                  styles.reactionMore,
                  { backgroundColor: theme.surfaceSecondary },
                  pressed && { backgroundColor: theme.surfaceHighlight },
                ]}
              >
                <Text style={[styles.reactionMoreText, { color: theme.text }]}>+</Text>
              </Pressable>
            )}
          </Animated.View>
        )}
        <Animated.View
          style={[
            styles.contextMenu,
            themedStyles.menu,
            localPosition,
            placed
              ? {
                  opacity: reveal,
                  transform: [
                    {
                      scale: reveal.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 1],
                      }),
                    },
                  ],
                }
              : null,
          ]}
          onLayout={handleMenuLayout}
        >
          {!isReply && !config?.disableReplies && (
            <>
              <MenuItem testID="menu-reply" onPress={handleReplyMessage}>
                <Text style={[styles.menuText, themedStyles.text]}>
                  {MESSAGE_INTERACTIONS.REPLY}
                </Text>
                <MESSAGE_INTERACTIONS_ICONS.REPLY color={theme.text} />
              </MenuItem>
              <Delimeter />
            </>
          )}
          <MenuItem onPress={() => handleCopyMessage(message.body!)}>
            <Text style={[styles.menuText, themedStyles.text]}>
              {MESSAGE_INTERACTIONS.COPY}
            </Text>
            <MESSAGE_INTERACTIONS_ICONS.COPY color={theme.text} />
          </MenuItem>
          {isUser && (
            <>
              {message?.isMediafile !== 'true' && canEditMessage(message) && (
                <>
                  <Delimeter />
                  <MenuItem onPress={handleEditMessage}>
                    <Text style={[styles.menuText, themedStyles.text]}>
                      {MESSAGE_INTERACTIONS.EDIT}
                    </Text>
                    <MESSAGE_INTERACTIONS_ICONS.EDIT color={theme.text} />
                  </MenuItem>
                </>
              )}
              <Delimeter />
              <MenuItem onPress={handleDeleteMessage}>
                <Text style={[styles.menuText, themedStyles.text]}>
                  {MESSAGE_INTERACTIONS.DELETE}
                </Text>
                <MESSAGE_INTERACTIONS_ICONS.DELETE />
              </MenuItem>
            </>
          )}
        </Animated.View>
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
    ...StyleSheet.absoluteFill,
    backgroundColor: 'transparent',
  },
  dim: {
    ...StyleSheet.absoluteFill,
  },
  preview: {
    position: 'absolute',
    // A message taller than the screen is cut at the bottom.
    overflow: 'hidden',
  },
  reactionBar: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 28,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
  },
  reactionItem: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionGlyph: {
    fontSize: 26,
  },
  reactionMore: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },
  reactionMoreText: {
    fontSize: 22,
    lineHeight: 24,
    fontWeight: '400',
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
