/** @format */

import React, { FC, useMemo } from 'react';
import { View, StyleSheet, Image, Text } from 'react-native';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { BurgerMenuIcon } from '../../assets/icons';
import Button from '../styled/Button';

interface HeaderRoomListProps {
  setDrawerOpen: () => void;
}

export const HeaderRoomList: FC<HeaderRoomListProps> = ({ setDrawerOpen }) => {
  const { config, user, selectedUser } = useChatSettingState();

  const modalUser: any = selectedUser ?? user;

  const HeaderLogo = useMemo(() => {
    const image = config?.headerLogo;

    if (image) {
      if (typeof image === 'function') {
        const SvgComponent = image as React.FC<React.SVGProps<SVGSVGElement>>;
        return <SvgComponent />;
      } else if (typeof image === 'string') {
        return <Image source={{ uri: image }} />;
      } else {
        return image;
      }
    }

    return <View />;
  }, [config?.backgroundChat?.image]);

  return (
    <View style={styles.headerContainer}>
      {!config?.disableRoomMenu && config?.headerMenu ? (
        <View style={styles.leftContainer}>
          <Button
            style={styles.menuButton}
            color="black"
            unstyled
            EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
            onPress={() => config?.headerMenu && config?.headerMenu()}
          />
        </View>
      ) : (
        <View style={styles.leftContainer} />
      )}
      <View style={styles.centerContainer}>
        {config?.headerLogo ? (
          HeaderLogo
        ) : (
          <Text style={{ fontWeight: 500, fontSize: 18 }}>Chats</Text>
        )}
      </View>
      <View style={styles.rightContainer}>
        <ProfileImagePlaceholder
          icon={modalUser?.profileImage ?? null}
          name={modalUser?.name ?? modalUser?.firstName}
          size={36}
          click={{
            isClick: true,
            onPress: setDrawerOpen,
          }}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    minHeight: 56,
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    // Lifts the header off the page ground behind it.
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 4,
    zIndex: 2,
  },
  menuButton: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  leftContainer: {
    width: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  centerContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightContainer: {
    width: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
