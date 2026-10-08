/** @format */

import React, { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  CenterContainer,
  ChatContainerHeader,
  ChatContainerHeaderBoxInfo,
  ChatContainerHeaderInfo,
  ChatContainerHeaderLabel,
} from '../styled/StyledComponents';
import RoomList from './RoomList';
import { IRoom } from '../../types/types';
import { ProfileImagePlaceholder } from './ProfileImagePlaceholder';
import Button from '../styled/Button';
import { BackIcon, BurgerMenuIcon, LockIcon } from '../../assets/icons';
import { CallButtons } from '../VideoCalls/CallButtons';
import { LanguageSelectorButton } from './LanguageSelectorButton';
import { MessageSearchButton } from './MessageSearchButton';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { RootState } from '../../roomStore';
import Composing from '../styled/StyledInputComponents/Composing';
import {
  deleteRoom,
  setCurrentRoom,
  setIsLoading,
} from '../../roomStore/roomsSlice';
import { useXmppClient } from '../../context/xmppProvider';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { RoomMenu } from '../MenuRoom/MenuRoom';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { useFileToken } from '../../hooks/useFileToken';
import { appendFileToken } from '../../helpers/secureFileUrl';
import { View, StyleSheet, Text, Keyboard } from 'react-native';
import { getIconColor } from '../../helpers/getIconColor';
import { useTheme } from '../../hooks/useTheme';
import { resolveHeaderHeight } from '../../helpers/headerLayout';
import { getElementFont } from '../../helpers/getElementFont';
import { useT } from '../../i18n/useT';
import { getRoomUserCount } from '../../helpers/roomUserCount';
import { useConnectionLabel } from '../../hooks/useConnectionLabel';

interface ChatHeaderProps {
  currentRoom: IRoom;
  handleBackClick?: (value: boolean) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentRoom,
  handleBackClick,
}) => {
  const fileToken = useFileToken();
  const dispatch = useDispatch();
  const { client } = useXmppClient();

  const reduxStore = useStore<RootState>();
  const activeRoomJID = useSelector(
    (state: RootState) => state.rooms.activeRoomJID
  );
  const roomState = useSelector((state: RootState) =>
    currentRoom?.jid ? state.rooms.rooms?.[currentRoom.jid] : undefined
  );
  const { config } = useChatSettingState();
  const roomsList = useSelector((state: RootState) =>
    config?.chatHeaderBurgerMenu ? state.rooms.rooms : null
  );
  const composing = roomState?.composing;
  const theme = useTheme();
  const t = useT();
  const connectionLabel = useConnectionLabel();

  // usersCnt is the room's true total, members[] can be a truncated page of
  // a big room: show the larger of the two.
  const userCount = getRoomUserCount(roomState || currentRoom);

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({ roomJID: chat.jid }));
    dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
  };

  const handleLeaveClick = useCallback(() => {
    client?.leaveTheRoomStanza(activeRoomJID!);
    dispatch(deleteRoom({ jid: activeRoomJID! }));

    const nextRoomJID =
      Object.keys(reduxStore.getState().rooms.rooms || {})[0] || null;
    if (nextRoomJID) {
      dispatch(setCurrentRoom({ roomJID: nextRoomJID }));
    }
  }, [activeRoomJID, reduxStore, dispatch, client]);

  const handleHeaderChatMenu = () => {
    Keyboard.dismiss();
    config?.headerChatMenu && config?.headerChatMenu();
  };

  // Shared open-chat-info handler used by BOTH the outer touchable row
  // and the avatar's own press (the avatar otherwise absorbs taps without
  // bubbling — see the comment on ProfileImagePlaceholder below).
  const openChatInfo = useCallback(
    () => dispatch(setActiveModal(MODAL_TYPES.CHAT_PROFILE)),
    [dispatch]
  );

  // Fixed band height shared with the modal headers. Zero vertical padding
  // here so `height` defines the band exactly (content centers via the
  // styled `align-items: center`); the styled 12px vertical padding would
  // otherwise add on top of it.
  const insets = useSafeAreaInsets();
  const topInset = config?.headerLayout?.safeAreaTop ? insets.top : 0;
  const headerHeight = resolveHeaderHeight(config?.headerLayout?.height) + topInset;

  return (
    <>
      <ChatContainerHeader
        style={{ height: headerHeight, paddingTop: topInset, paddingBottom: 0 }}
      >
        {handleBackClick && !config?.headerChatMenu ? (
          <View style={styles.leftContainer}>
            <Button
              EndIcon={<BackIcon color={theme.textSecondary} />}
              onPress={() => handleBackClick(false)}
            />
          </View>
        ) : !config?.disableChatHeaderBurgerMenuIcon ? (
          <View style={styles.leftContainer}>
            <Button
              style={styles.menuButton}
              color={theme.text}
              unstyled
              EndIcon={<BurgerMenuIcon color={getIconColor(config)} />}
              onPress={handleHeaderChatMenu}
            />
          </View>
        ) : null
        /* Don't reserve the 15%-wide leftContainer when both the back
         * button is absent AND the burger icon is hidden — the empty
         * slot used to steal width from the title row, clipping the chat
         * name. Customer-reported #15. The right action area still fills
         * its own slot, so the title now starts at the left edge as
         * intended by `disableChatHeaderBurgerMenuIcon`. */
        }
        <CenterContainer
          style={{minHeight: 40 }}
          rightSpace={config?.disableRoomConfig}
          leftSpace={!!config?.headerChatMenu}
        >
          {config?.chatHeaderBurgerMenu && roomsList && (
            <RoomList
              chats={Object.values(roomsList)}
              burgerMenu
              onRoomClick={handleChangeChat}
            />
          )}
          <ChatContainerHeaderBoxInfo
            onPress={openChatInfo}
            // Gates the entry to the CHAT-INFO modal (room name, members,
            // settings) via the dedicated `disableChatInfo.disableChatHeaderMenu`
            // flag. Previously wired to `disableProfilesInteractions`, which
            // is for USER-profile popups (the in-bubble avatar tap, see
            // Message.tsx) — wrong semantic gate, and it meant a consumer
            // who wanted to hide user profiles also lost their entry to
            // the chat info screen.
            disabled={config?.disableChatInfo?.disableChatHeaderMenu}
          >
            {/* No wrapping <View> here: ProfileImagePlaceholder renders
              * its avatar as a TouchableOpacity (AvatarCircle) that
              * INTERCEPTS taps even when its own onPress is undefined —
              * so without forwarding a press handler, tapping the chat
              * avatar did nothing (clicks on the name worked because
              * those bubble up to the outer TouchableOpacity). Pass
              * `click` so the avatar fires the same openChatInfo
              * dispatch; the surrounding text + the gap between avatar
              * and text continue to be handled by the outer
              * ChatContainerHeaderBoxInfo. */}
            <ProfileImagePlaceholder
              name={currentRoom?.title || currentRoom?.name}
              size={40}
              icon={appendFileToken(currentRoom?.icon, fileToken)}
              active={!config?.disableChatInfo?.disableChatHeaderMenu}
              click={
                config?.disableChatInfo?.disableChatHeaderMenu
                  ? undefined
                  : { isClick: true, onPress: openChatInfo }
              }
            />
            <ChatContainerHeaderInfo>
              <View style={styles.titleRow}>
                <ChatContainerHeaderLabel
                  numberOfLines={1}
                  ellipsizeMode="tail"
                  fontSize={config?.typography?.headerTitle?.fontSize}
                  fontWeight={config?.typography?.headerTitle?.fontWeight as any}
                  style={styles.title}
                >
                  {currentRoom?.title || currentRoom?.name}
                </ChatContainerHeaderLabel>
                {currentRoom?.e2ee && (
                  <View
                    accessible
                    accessibilityRole="image"
                    accessibilityLabel={t('e2ee.roomEncrypted')}
                    testID="header-e2ee-lock"
                  >
                    <LockIcon width={15} height={15} color={theme.textSecondary} />
                  </View>
                )}
              </View>
              <View style={styles.subtitleBox}>
                {connectionLabel ? (
                  // The session's state takes the subtitle's place: no
                  // typing or member count is current while it is off.
                  <ChatContainerHeaderLabel
                    testID="chat-header-connection"
                    style={[
                      styles.subLabel,
                      { color: theme.textSecondary },
                      getElementFont(config, 'headerSubtitle'),
                    ]}
                  >
                    <Text>{connectionLabel}</Text>
                  </ChatContainerHeaderLabel>
                ) : composing ? (
                  <Composing usersTyping={currentRoom?.composingList} />
                ) : config?.disableUserCount ? undefined : (
                  <ChatContainerHeaderLabel
                    // One line, ellipsized: a long count in a narrow header
                    // must not wrap and push the header buttons around.
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[
                      styles.subLabel,
                      { color: theme.textSecondary },
                      getElementFont(config, 'headerSubtitle'),
                    ]}
                  >
                    <Text>
                      {t(
                        userCount === 1
                          ? 'header.userCountSingular'
                          : 'header.userCountPlural',
                        { count: userCount }
                      )}
                    </Text>
                  </ChatContainerHeaderLabel>
                )}
              </View>
            </ChatContainerHeaderInfo>
          </ChatContainerHeaderBoxInfo>
        </CenterContainer>

        <View style={styles.rightContainer}>
          {/* Renders nothing unless config.videoCalls is on and this is a
              1:1 room, so it costs non-call hosts nothing. */}
          <MessageSearchButton />
          <LanguageSelectorButton />
          <CallButtons />
          {!config?.disableChatInfo?.disableRoomMenu && (
            <RoomMenu handleLeaveClick={handleLeaveClick} />
          )}
        </View>
      </ChatContainerHeader>
      {config?.chatHeaderAdditional?.enabled &&
          config.chatHeaderAdditional.element()}
    </>
  );
};

const styles = StyleSheet.create({
  subLabel: {
    color: '#8C8C8C',
    fontSize: 14,
    flexShrink: 1,
  },
  subtitleBox: {
    flexShrink: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  title: {
    flexShrink: 1,
  },
  menuButton: {
    padding: 8,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  leftContainer: {
    alignItems: 'flex-start',
    width: '15%',
  },
  rightContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    // Sized to its icons rather than a fixed 25%: the cluster is 1 to 4
    // icons depending on config (globe, audio call, video call, room menu),
    // and a fixed share either cramped them together or reserved dead space
    // that the title could have used. `flexShrink: 0` keeps them intact
    // while CenterContainer (flex:1, min-width:0) absorbs the difference.
    flexShrink: 0,
  },
});

export default ChatHeader;
