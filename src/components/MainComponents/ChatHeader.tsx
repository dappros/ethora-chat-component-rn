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

  return (
    <>
      <ChatContainerHeader>
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
              EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
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
            onPress={() => dispatch(setActiveModal(MODAL_TYPES.CHAT_PROFILE))}
            disabled={config?.disableProfilesInteractions}
          >
            <View>
              <ProfileImagePlaceholder
                name={currentRoom?.title || currentRoom?.name}
                size={40}
                icon={currentRoom?.icon}
                active={!config?.disableProfilesInteractions || true}
              />
            </View>
            <ChatContainerHeaderInfo>
              <ChatContainerHeaderLabel numberOfLines={1} ellipsizeMode="tail">
                {currentRoom?.title || currentRoom?.name}
              </ChatContainerHeaderLabel>
              <View>
                {composing ? (
                  <Composing usersTyping={currentRoom?.composingList} />
                ) : config?.disableUserCount ? undefined : (
                  <ChatContainerHeaderLabel style={styles.subLabel}>
                    <Text>{`${currentRoom?.usersCnt} users`}</Text>
                  </ChatContainerHeaderLabel>
                )}
              </View>
            </ChatContainerHeaderInfo>
          </ChatContainerHeaderBoxInfo>
        </CenterContainer>

        {!config?.disableRoomConfig ? (
          <View style={styles.rightContainer}>
            <RoomMenu handleLeaveClick={handleLeaveClick} />
          </View>
        ) : (
          <View style={styles.rightContainer} />
        )}
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
    alignItems: 'flex-end',
    width: '15%',
  },
});

export default ChatHeader;
