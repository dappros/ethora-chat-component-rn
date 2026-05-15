import React, { FC, useMemo } from 'react';
import {
  Animated,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Dimensions,
  View,
} from 'react-native';
import { AddNewIcon, ProfileIcon, SettingIcon } from '../../assets/icons';
import { useDispatch } from 'react-redux';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';

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

  const drawerTranslateX = drawerAnimation.interpolate({
    inputRange: [0, 1],
    outputRange: [width, 0],
  });

  const menuOptions = useMemo(
    () => [
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
      // {
      //   label: "Logout",
      //   onClick: handleLogout,
      // },
    ],
    []
  );

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
              onPress={() => {
                option.onClick();
                closeDrawer();
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
