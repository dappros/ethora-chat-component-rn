/** @format */

import React, {useCallback} from 'react';
import {
  CenterContainer,
  ChatContainerHeader,
  ChatContainerHeaderBoxInfo,
  ChatContainerHeaderInfo,
  ChatContainerHeaderLabel,
} from '../styled/StyledComponents';
import RoomList from './RoomList';
import {IRoom} from '../../types/types';
import {ProfileImagePlaceholder} from './ProfileImagePlaceholder';
import Button from '../styled/Button';
import {BackIcon, BurgerMenuIcon} from '../../assets/icons';
import {useDispatch} from 'react-redux';
import Composing from '../styled/StyledInputComponents/Composing';
import {
  deleteRoom,
  setCurrentRoom,
  setIsLoading,
} from '../../roomStore/roomsSlice';
import {useXmppClient} from '../../context/xmppProvider';
import {setActiveModal} from '../../roomStore/chatSettingsSlice';
import {MODAL_TYPES} from '../../helpers/constants/MODAL_TYPES';
import {RoomMenu} from '../MenuRoom/MenuRoom';
import {useRoomState} from '../../hooks/useRoomState';
import {useChatSettingState} from '../../hooks/useChatSettingState';
import {View, StyleSheet, Text} from 'react-native';

interface ChatHeaderProps {
  currentRoom: IRoom;
  handleBackClick?: (value: boolean) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  currentRoom,
  handleBackClick,
}) => {
  const dispatch = useDispatch();
  const {client} = useXmppClient();

  const {roomsList, activeRoomJID} = useRoomState(currentRoom.jid);
  const {composing} = useRoomState(currentRoom.jid).room;
  const {config} = useChatSettingState();

  const handleChangeChat = (chat: IRoom) => {
    dispatch(setCurrentRoom({roomJID: chat.jid}));
    dispatch(setIsLoading({chatJID: chat.jid, loading: true}));
  };

  const handleLeaveClick = useCallback(() => {
    client.leaveTheRoomStanza(activeRoomJID!);
    dispatch(deleteRoom({jid: activeRoomJID!}));

    const nextRoomJID = Object.keys(roomsList)[0] || null;
    if (nextRoomJID) {
      dispatch(setCurrentRoom({roomJID: nextRoomJID}));
    }
  }, [activeRoomJID, roomsList, dispatch, client]);

  return (
    <ChatContainerHeader>
      {handleBackClick && !config?.headerChatMenu ? (
        <View style={styles.leftContainer}>
          <Button
            EndIcon={<BackIcon />}
            onPress={() => handleBackClick(false)}
          />
        </View>
      ) : (
        <View style={styles.leftContainer}>
          <Button
            style={styles.menuButton}
            color="black"
            unstyled
            EndIcon={<BurgerMenuIcon color={config?.colors?.primary} />}
            onPress={() => config?.headerChatMenu && config?.headerChatMenu()}
          />
        </View>
      )}
      <CenterContainer
        rightSpace={config?.disableRoomConfig}
        leftSpace={!!config?.headerChatMenu}>
        {config?.chatHeaderBurgerMenu && roomsList && (
          <RoomList
            chats={Object.values(roomsList)}
            burgerMenu
            onRoomClick={handleChangeChat}
          />
        )}
        <ChatContainerHeaderBoxInfo
          onPress={() => dispatch(setActiveModal(MODAL_TYPES.CHAT_PROFILE))}
          disabled={config?.disableProfilesInteractions}>
          <View>
            <ProfileImagePlaceholder
              name={currentRoom.name}
              size={40}
              icon={currentRoom?.icon}
              active={!config?.disableProfilesInteractions || true}
            />
          </View>
          <ChatContainerHeaderInfo>
            <ChatContainerHeaderLabel numberOfLines={1} ellipsizeMode="tail">
              {currentRoom?.title}
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
