/** @format */

import React, { useCallback } from 'react';
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
import { BackIcon, BurgerMenuIcon } from '../../assets/icons';
import { CallButtons } from '../VideoCalls/CallButtons';
import { LanguageSelectorButton } from './LanguageSelectorButton';
import { useDispatch } from 'react-redux';
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
import { useRoomState } from '../../hooks/useRoomState';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { View, StyleSheet, Text, Keyboard } from 'react-native';
import { getIconColor } from '../../helpers/getIconColor';
import { resolveHeaderHeight } from '../../helpers/headerLayout';
import { getElementFont } from '../../helpers/getElementFont';
import { useT } from '../../i18n/useT';

interface ChatHeaderProps {
  currentRoom: IRoom;
  handleBackClick?: (value: boolean) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentRoom,
  handleBackClick,
}) => {
  const dispatch = useDispatch();
  const { client } = useXmppClient();

  const { roomsList, activeRoomJID } = useRoomState(currentRoom.jid);
  const roomState = useRoomState(currentRoom.jid).room;
  const composing = roomState?.composing;
  const { config } = useChatSettingState();
  const t = useT();

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({ roomJID: chat.jid }));
    dispatch(setIsLoading({ chatJID: chat.jid, loading: true }));
  };

  const handleLeaveClick = useCallback(() => {
    client?.leaveTheRoomStanza(activeRoomJID!);
    dispatch(deleteRoom({ jid: activeRoomJID! }));

    const nextRoomJID = Object.keys(roomsList)[0] || null;
    if (nextRoomJID) {
      dispatch(setCurrentRoom({ roomJID: nextRoomJID }));
    }
  }, [activeRoomJID, roomsList, dispatch, client]);

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
  const headerHeight = resolveHeaderHeight(config?.headerLayout?.height);

  return (
    <>
      <ChatContainerHeader
        style={{ height: headerHeight, paddingTop: 0, paddingBottom: 0 }}
      >
        {handleBackClick && !config?.headerChatMenu ? (
          <View style={styles.leftContainer}>
            <Button
              EndIcon={<BackIcon />}
              onPress={() => handleBackClick(false)}
            />
          </View>
        ) : !config?.disableChatHeaderBurgerMenuIcon ? (
          <View style={styles.leftContainer}>
            <Button
              style={styles.menuButton}
              color="black"
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
              icon={currentRoom?.icon}
              active={!config?.disableChatInfo?.disableChatHeaderMenu}
              click={
                config?.disableChatInfo?.disableChatHeaderMenu
                  ? undefined
                  : { isClick: true, onPress: openChatInfo }
              }
            />
            <ChatContainerHeaderInfo>
              <ChatContainerHeaderLabel
                numberOfLines={1}
                ellipsizeMode="tail"
                fontSize={config?.typography?.headerTitle?.fontSize}
                fontWeight={config?.typography?.headerTitle?.fontWeight as any}
              >
              {currentRoom?.title || currentRoom?.name}
              </ChatContainerHeaderLabel>
              <View>
                {composing ? (
                  <Composing usersTyping={currentRoom?.composingList} />
                ) : config?.disableUserCount ? undefined : (
                  <ChatContainerHeaderLabel
                    style={[styles.subLabel, getElementFont(config, 'headerSubtitle')]}
                  >
                    <Text>
                      {t(
                        Number(currentRoom?.usersCnt) === 1
                          ? 'header.userCountSingular'
                          : 'header.userCountPlural',
                        { count: Number(currentRoom?.usersCnt) || 0 }
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
