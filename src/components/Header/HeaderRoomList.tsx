/** @format */

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import React, { FC, useMemo } from 'react';
import { ActivityIndicator, View, StyleSheet, Image, Text } from 'react-native';
import { ProfileImagePlaceholder } from '../MainComponents/ProfileImagePlaceholder';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { BurgerMenuIcon, DiscoverIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { useDispatch } from 'react-redux';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { showsStandaloneDiscoverButton } from '../../helpers/publicChatsEntry';
import { useConnectionLabel } from '../../hooks/useConnectionLabel';
import { resolveHeaderHeight } from '../../helpers/headerLayout';

export const ROOM_LIST_HEADER_TRIM = 5;
const ROOM_LIST_HEADER_LIFT = 6;

interface HeaderRoomListProps {
  setDrawerOpen: () => void;
}

export const HeaderRoomList: FC<HeaderRoomListProps> = ({ setDrawerOpen }) => {
  const { config, user, selectedUser } = useChatSettingState();
  const theme = useTheme();
  const t = useT();
  const dispatch = useDispatch();
  const connectionLabel = useConnectionLabel();
  const insets = useSafeAreaInsets();
  const topInset = config?.headerLayout?.safeAreaTop ? insets.top : 0;
  // Same fixed band as ChatHeader / modal headers: the safe-area inset is
  // padded on top and the row (buttons + title) centers in the band below it.
  const headerHeight =
    resolveHeaderHeight(config?.headerLayout?.height) - ROOM_LIST_HEADER_TRIM + topInset;

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
    <View
      style={[
        styles.headerContainer,
        { backgroundColor: theme.surface, shadowColor: theme.shadow },
        { height: headerHeight, paddingTop: topInset, paddingBottom: ROOM_LIST_HEADER_LIFT },
      ]}
    >
      {!config?.disableRoomMenu && config?.headerMenu ? (
        <View style={styles.leftContainer}>
          <Button
            testID="room-list-burger"
            style={styles.menuButton}
            color="black"
            unstyled
            EndIcon={<BurgerMenuIcon color={theme.icon} />}
            onPress={() =>
              typeof config?.headerMenu === 'function'
                ? config.headerMenu()
                : setDrawerOpen()
            }
          />
        </View>
      ) : (
        <View style={styles.leftContainer} />
      )}
      <View
        style={[
          styles.centerContainer,
          { top: topInset, bottom: ROOM_LIST_HEADER_LIFT },
        ]}
      >
        {connectionLabel ? (
          // The title gives way to the session's state: the list is not
          // live until the stream is up and the rooms re-joined.
          <View style={styles.connection} testID="room-list-connection">
            <ActivityIndicator size="small" color={theme.textSecondary} />
            <Text style={{ fontWeight: 500, fontSize: 16, color: theme.textSecondary }}>
              {connectionLabel}
            </Text>
          </View>
        ) : config?.headerLogo ? (
          HeaderLogo
        ) : (
          <Text style={{ fontWeight: 500, fontSize: 18, color: theme.text }}>
            {t('roomList.title')}
          </Text>
        )}
      </View>
      <View style={styles.rightContainer}>
        {showsStandaloneDiscoverButton(config) && (
          <Button
            testID="room-list-discover"
            style={styles.menuButton}
            unstyled
            EndIcon={<DiscoverIcon color={theme.icon} />}
            onPress={() => dispatch(setActiveModal(MODAL_TYPES.PUBLIC_CHATS))}
            accessibilityLabel={t('publicChats.title')}
          />
        )}
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
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  headerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    justifyContent: 'space-between',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    minWidth: 44,
  },
});
