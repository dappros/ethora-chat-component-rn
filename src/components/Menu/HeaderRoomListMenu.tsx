import React, { FC, useMemo } from 'react';
import {
  Alert,
  Animated,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  View,
} from 'react-native';
import {
  AddNewIcon,
  LogoutIcon,
  ProfileIcon,
  SettingIcon,
} from '../../assets/icons';
import { useDispatch } from 'react-redux';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useLogout } from '../../hooks/useLogout';
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

const { width } = Dimensions.get('window');

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

  const drawerTranslateX = drawerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [width, 0],
  });

  const menuOptions = useMemo(() => {
    const options: {
      label: string;
      icon: React.ReactElement;
      onClick: () => void;
      styles?: { color: string };
      /** When true the row closes the drawer itself before acting. */
      closesDrawer?: boolean;
    }[] = [
      {
        label: 'New Chat',
        icon: <AddNewIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.NEW_CHAT));
          console.log('New chat clicked');
        },
        styles: { color: '#141414' },
      },
      {
        label: 'Profile',
        icon: <ProfileIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
          console.log('Profile clicked');
        },
      },
      {
        label: 'Settings',
        icon: <SettingIcon color="#8C8C8C" />,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
          console.log('Settings clicked');
        },
      },
    ];
    if (logoutConfig) {
      options.push({
        label: logoutConfig.label ?? DEFAULT_LOGOUT_LABEL,
        icon: <LogoutIcon color={primaryColor} />,
        styles: { color: primaryColor },
        closesDrawer: true,
        onClick: () => {
          closeDrawer();
          runLogoutFlow(logoutConfig, performLogout).catch(() => {});
        },
      });
    }
    return options;
  }, [dispatch, logoutConfig, performLogout, primaryColor, closeDrawer]);

  return (
    <>
      <Animated.View
        style={[
          styles.drawer,
          { transform: [{ translateX: drawerTranslateX }] },
        ]}
      >
        {menuOptions.map((option, index) => (
          <View key={index} style={styles.menuItemWrapper}>
            <TouchableOpacity
              style={styles.menuItem}
              testID={`header-menu-${option.label}`}
              onPress={() => {
                option.onClick();
                if (!option.closesDrawer) {
                  closeDrawer();
                }
              }}
            >
              <View
                style={{
                  width: 22,
                  alignItems: 'center',
                }}
              >
                {option.icon}
              </View>
              <Text style={[styles.label, option?.styles]}>{option.label}</Text>
            </TouchableOpacity>
            {index < menuOptions.length - 1 && <View style={styles.divider} />}
          </View>
        ))}
      </Animated.View>
      {isDrawerOpen && (
        <TouchableWithoutFeedback onPress={closeDrawer}>
          <Animated.View
            style={[styles.overlay, { opacity: overlayAnimation }]}
          />
        </TouchableWithoutFeedback>
      )}
    </>
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
    padding: 16,
  },
  label: {
    fontSize: 16,
    marginLeft: 10,
  },
  divider: {
    height: 1,
    width: '100%',
    backgroundColor: '#0052cd0d',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: width * 0.7,
    backgroundColor: '#fff',
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: -2, height: 0 },
    shadowRadius: 5,
    elevation: 5,
    zIndex: 999,
  },
  drawerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  drawerItem: {
    fontSize: 18,
    marginBottom: 10,
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
