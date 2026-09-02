/** @format */

import React, { useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MoreIcon } from '../../../assets/icons';

export interface ProfileMenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  onPress: () => void;
}

/** Fallbacks used for the very first frame, before the card is measured. */
const ESTIMATED_WIDTH = 220;
const ESTIMATED_HEIGHT = 160;
const GAP = 8;
/** Roughly a notch inset + the header band, used until measured. */
const DEFAULT_TOP = 104;
const EDGE = 12;

/**
 * The "…" overflow menu shared by the chat and user profile screens.
 *
 * The shared `DropdownMenu` pins its card at a hard-coded `top: 95`, which
 * on this screen landed it over the host's own tab bar, unanchored to the
 * button. This one measures the button and grows the card out of it: the
 * card scales up from its top-right corner (translate → scale → translate
 * back, which is how you fake a transform-origin in React Native) so the
 * menu visibly unfolds from the three dots.
 */
const ProfileMenu: React.FC<{
  items: ProfileMenuItem[];
  testIDPrefix?: string;
}> = ({ items, testIDPrefix = 'chat-profile' }) => {
  const buttonRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: DEFAULT_TOP, right: EDGE });
  const [size, setSize] = useState({
    width: ESTIMATED_WIDTH,
    height: ESTIMATED_HEIGHT,
  });
  const progress = useRef(new Animated.Value(0)).current;

  const animate = (to: number, done?: () => void) =>
    Animated.timing(progress, {
      toValue: to,
      duration: to ? 180 : 140,
      easing: to ? Easing.out(Easing.back(1.3)) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => finished && done?.());

  // Anchor to the button's window frame — that is the same coordinate
  // space the <Modal> lays out in, so no insets to subtract. Measured on
  // layout (and again on open) rather than *before* opening: on some hosts
  // the measure callback never fires, and gating the open on it would mean
  // a menu that simply doesn't appear.
  const measure = () =>
    buttonRef.current?.measureInWindow?.((x, y, width, height) => {
      if (typeof y !== 'number' || typeof x !== 'number') {return;}
      const screenWidth = Dimensions.get('window').width;
      setAnchor({
        top: y + height + GAP,
        right: Math.max(screenWidth - (x + width), EDGE),
      });
    });

  const openMenu = () => {
    measure();
    progress.setValue(0);
    setOpen(true);
    animate(1);
  };

  const closeMenu = (then?: () => void) =>
    animate(0, () => {
      setOpen(false);
      then?.();
    });

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1],
  });

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <View ref={buttonRef} collapsable={false} onLayout={measure}>
        <TouchableOpacity
          testID={`${testIDPrefix}-menu`}
          activeOpacity={0.7}
          onPress={openMenu}
          style={styles.button}
        >
          <MoreIcon color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <Modal
        transparent
        visible={open}
        animationType="none"
        onRequestClose={() => closeMenu()}
      >
        <Pressable
          testID={`${testIDPrefix}-menu-backdrop`}
          style={StyleSheet.absoluteFill}
          onPress={() => closeMenu()}
        />
        <Animated.View
          testID={`${testIDPrefix}-menu-card`}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width && height) {setSize({ width, height });}
          }}
          style={[
            styles.card,
            {
              top: anchor.top,
              right: anchor.right,
              opacity: progress,
              transform: [
                // Move the origin to the card's top-right corner, scale
                // there, then move back — RN has no transform-origin.
                { translateX: size.width / 2 },
                { translateY: -size.height / 2 },
                { scale },
                { translateX: -size.width / 2 },
                { translateY: size.height / 2 },
              ],
            },
          ]}
        >
          {items.map((item, index) => (
            <TouchableOpacity
              key={item.key}
              testID={`${testIDPrefix}-menu-${item.key}`}
              activeOpacity={0.6}
              style={[styles.row, index > 0 && styles.rowDivider]}
              onPress={() => closeMenu(item.onPress)}
            >
              <Text
                style={[styles.label, item.destructive && styles.destructive]}
              >
                {item.label}
              </Text>
              <View style={styles.icon}>{item.icon}</View>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    position: 'absolute',
    minWidth: 200,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 4,
    shadowColor: '#121219',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 24,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFF2',
  },
  label: {
    fontSize: 16,
    color: '#141414',
  },
  destructive: {
    color: '#E53935',
  },
  icon: {
    width: 22,
    alignItems: 'center',
  },
});

export default ProfileMenu;
