import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  Modal,
  PanResponder,
  Platform,
  View,
} from 'react-native';
import {
  AddNewIcon,
  LogoutIcon,
  ProfileIcon,
  SettingIcon,
} from '../../assets/icons';
import { useDispatch } from 'react-redux';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useLogout } from '../../hooks/useLogout';
import {
  shouldClaimVerticalDrag,
  shouldDismissOnDrag,
} from '../../helpers/sheetGestures';
import type { IConfig } from '../../types/types';

type LogoutConfig = NonNullable<IConfig['logout']>;

const DEFAULT_LOGOUT_LABEL = 'Sign out';

const confirmLogout = (
  confirm: LogoutConfig['confirm'],
  label: string
): Promise<boolean> => {
  if (confirm === false) {
    return Promise.resolve(true);
  }
  const copy = typeof confirm === 'object' && confirm ? confirm : {};
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      copy.title ?? label,
      copy.message ?? 'Are you sure you want to sign out?',
      [
        {
          text: copy.cancelText ?? 'Cancel',
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: copy.confirmText ?? label,
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
};

export const runLogoutFlow = async (
  logoutConfig: LogoutConfig,
  performLogout: () => Promise<void>
): Promise<void> => {
  const label = logoutConfig.label ?? DEFAULT_LOGOUT_LABEL;
  const confirmed = await confirmLogout(logoutConfig.confirm ?? true, label);
  if (!confirmed) {
    return;
  }
  if (logoutConfig.onBeforeLogout) {
    try {
      const proceed = await logoutConfig.onBeforeLogout();
      if (proceed === false) {
        return;
      }
    } catch (e) {
      console.warn('HeaderRoomListMenu: onBeforeLogout threw, logout cancelled', e);
      return;
    }
  }
  await performLogout(); // never rejects (see useLogout)
  if (logoutConfig.onAfterLogout) {
    try {
      await logoutConfig.onAfterLogout();
    } catch (e) {
      console.warn('HeaderRoomListMenu: onAfterLogout threw', e);
    }
  }
};

const { height: windowHeight } = Dimensions.get('window');

interface HeaderRoomListMenuProps {
  isDrawerOpen: boolean;
  drawerAnimation: Animated.Value;
  overlayAnimation: Animated.Value;
  closeDrawer: () => void;
}

export const HeaderRoomListMenu: FC<HeaderRoomListMenuProps> = ({
  isDrawerOpen,
  drawerAnimation,
  overlayAnimation,
  closeDrawer,
}) => {
  const dispatch = useDispatch();
  const { config } = useChatSettingState();
  const performLogout = useLogout();
  const logoutConfig = config?.logout?.enabled ? config.logout : undefined;
  const primaryColor = config?.colors?.primary ?? '#0052CD';

  const insets = useSafeAreaInsets();
  // Measured, so the sheet is exactly as tall as its rows and starts
  // fully off-screen no matter how many options the host enables.
  const [sheetHeight, setSheetHeight] = useState(windowHeight * 0.4);
  // Finger offset, layered on top of the open/close animation the parent
  // drives. Reset once the sheet is unmounted, so a swipe-dismissed sheet
  // never snaps back into view on its way out.
  const dragY = useRef(new Animated.Value(0)).current;
  const sheetHeightRef = useRef(sheetHeight);
  sheetHeightRef.current = sheetHeight;

  // closeDrawer is a fresh function each render; the responder is built
  // once, so it reads the current one through a ref rather than the one it
  // closed over on mount.
  const closeDrawerRef = useRef(closeDrawer);
  closeDrawerRef.current = closeDrawer;

  const pendingActionRef = useRef<(() => void) | null>(null);

  const runPendingAction = useCallback(() => {
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    action?.();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'ios' || isDrawerOpen) {
      return;
    }
    const id = setTimeout(runPendingAction, 0);
    return () => clearTimeout(id);
  }, [isDrawerOpen, runPendingAction]);

  const handleOptionPress = useCallback(
    (action: () => void) => {
      pendingActionRef.current = action;
      closeDrawer();
    },
    [closeDrawer]
  );

  useEffect(() => {
    if (!isDrawerOpen) {
      dragY.setValue(0);
      return;
    }
    // Hand `dragY` to the native driver up front. The open/close value is
    // already native (the parent animates it that way), and a transform
    // that mixes a native node with a JS-only one drops the JS updates on
    // the floor — which is exactly a drag that moves nothing.
    Animated.timing(dragY, {
      toValue: 0,
      duration: 0,
      useNativeDriver: true,
    }).start();
  }, [isDrawerOpen, dragY]);

  const openTranslateY = drawerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });

  const dismissByDrag = () => {
    Animated.timing(dragY, {
      toValue: sheetHeightRef.current,
      duration: 180,
      useNativeDriver: true,
    }).start();
    closeDrawerRef.current();
  };

  const makeDragResponder = (claimOnStart: boolean) =>
    PanResponder.create({
      // The grab area claims on touch-DOWN: nothing to negotiate against,
      // so a pull on the handle always drags.
      onStartShouldSetPanResponder: () => claimOnStart,
      // CAPTURE matters on the body: a drag that starts on a row makes
      // that row's Touchable the responder on touch-down, and a plain
      // `onMoveShouldSetPanResponder` is never consulted afterwards.
      // Capturing on the first clearly-vertical movement takes the gesture
      // back, while a tap (dy ≈ 0) still reaches the row.
      onMoveShouldSetPanResponderCapture: (_evt, g) =>
        claimOnStart || shouldClaimVerticalDrag(g.dy, g.dx),
      onMoveShouldSetPanResponder: (_evt, g) =>
        claimOnStart || shouldClaimVerticalDrag(g.dy, g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_evt, g) => {
        dragY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_evt, g) => {
        if (shouldDismissOnDrag(g.dy, g.vy)) {
          dismissByDrag();
          return;
        }
        Animated.spring(dragY, {
          toValue: 0,
          tension: 90,
          friction: 14,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, {
          toValue: 0,
          tension: 90,
          friction: 14,
          useNativeDriver: true,
        }).start();
      },
    });

  // Built once — `useRef(expr)` would re-run PanResponder.create every
  // render and throw the result away.
  const bodyPanRef = useRef<ReturnType<typeof makeDragResponder> | null>(null);
  const handlePanRef = useRef<ReturnType<typeof makeDragResponder> | null>(null);
  if (!bodyPanRef.current) {bodyPanRef.current = makeDragResponder(false);}
  if (!handlePanRef.current) {handlePanRef.current = makeDragResponder(true);}
  const pan = bodyPanRef.current;
  const handlePan = handlePanRef.current;

  const menuOptions = useMemo(() => {
    const options: {
      label: string;
      icon: React.ReactElement;
      onClick: () => void;
      styles?: { color: string };
    }[] = [
      {
        label: 'New Chat',
        icon: <AddNewIcon color={primaryColor} />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.NEW_CHAT));
        },
        styles: { color: '#141414' },
      },
      {
        label: 'Profile',
        icon: <ProfileIcon color={primaryColor} />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
        },
      },
      {
        label: 'Settings',
        icon: <SettingIcon color={primaryColor} />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
        },
      },
    ];
    if (logoutConfig) {
      options.push({
        label: logoutConfig.label ?? DEFAULT_LOGOUT_LABEL,
        icon: <LogoutIcon color={primaryColor} />,
        styles: { color: primaryColor },
        onClick: () => {
          runLogoutFlow(logoutConfig, performLogout).catch(() => {});
        },
      });
    }
    return options;
  }, [dispatch, logoutConfig, performLogout, primaryColor]);

  return (
    // Presented through a real <Modal>: as an in-tree overlay the sheet was
    // bounded by the room list's own container, so it stopped short of the
    // screen's bottom edge (that pale strip under it) and the dim never
    // reached the host's chrome.
    <Modal
      transparent
      visible={isDrawerOpen}
      animationType="none"
      statusBarTranslucent
      onRequestClose={closeDrawer}
      onDismiss={runPendingAction}
    >
      <TouchableWithoutFeedback onPress={closeDrawer}>
        <Animated.View
          style={[styles.overlay, { opacity: overlayAnimation }]}
        />
      </TouchableWithoutFeedback>
      {/* A bottom sheet rather than the old full-height right-hand drawer:
        * three rows never needed the whole screen, and coming up from the
        * bottom keeps them within thumb reach. Inset by 2pt all round so a
        * sliver of the dimmed screen shows around it. */}
      <Animated.View
        testID="header-menu-sheet"
        onLayout={(e) => {
          const measured = e.nativeEvent.layout.height;
          if (measured > 0) {setSheetHeight(measured);}
        }}
        style={[
          styles.sheet,
          {
            paddingBottom: insets.bottom + 20,
            // Two entries rather than Animated.add: the parent's value is
            // driven natively, and stacking the transforms keeps each node
            // on its own driver instead of mixing them in one expression.
            transform: [{ translateY: openTranslateY }, { translateY: dragY }],
          },
        ]}
        {...pan.panHandlers}
      >
        {/* Full-width grab area, not just the 40pt pill: it claims the
          * gesture the moment it is touched. */}
        <View
          testID="header-menu-grabber"
          style={styles.grabArea}
          {...handlePan.panHandlers}
        >
          <View style={styles.grabber} />
        </View>
        <View style={styles.card}>
          {menuOptions.map((option, index) => (
            <View key={index} style={styles.menuItemWrapper}>
              <TouchableOpacity
                style={styles.menuItem}
                testID={`header-menu-${option.label}`}
                activeOpacity={0.6}
                onPress={() => handleOptionPress(option.onClick)}
              >
                <View style={styles.iconSlot}>{option.icon}</View>
                <Text style={[styles.label, option?.styles]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
              {index < menuOptions.length - 1 && (
                <View style={styles.divider} />
              )}
            </View>
          ))}
        </View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  menuItemWrapper: {
    display: 'flex',
    flexDirection: 'column',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  iconSlot: {
    width: 26,
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: '500',
    color: '#141414',
    marginLeft: 12,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 54,
    backgroundColor: '#E4E4E9',
  },
  sheet: {
    position: 'absolute',
    // Inset rather than flush: the dimmed screen stays visible as a thin
    // line around the sheet.
    left: 3,
    right: 3,
    bottom: 3,
    paddingTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 12,
    elevation: 12,
    zIndex: 999,
  },
  grabArea: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 12,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C9CBD1',
  },
  card: {
    overflow: 'hidden',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
});
