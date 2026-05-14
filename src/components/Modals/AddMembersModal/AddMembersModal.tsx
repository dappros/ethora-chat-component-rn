import React, { useState } from 'react';
import Button from '../../styled/Button';
import { useSelector } from 'react-redux';
import { getActiveRoom, RootState } from '../../../roomStore';
import { useXmppClient } from '../../../context/xmppProvider';
import {
  ActionButton,
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalTitle,
} from '../styledModalComponents';
import InputWithLabel from '../../styled/StyledInput';
import {
  getRoomByName,
  postAddRoomMember,
} from '../../../networking/api-requests/rooms.api';
import { addRoomViaApi } from '../../../roomStore/roomsSlice';
import { createRoomFromApi } from '../../../helpers/createRoomFromApi';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { useAppDispatch } from '../../../hooks/hooks';
import { Text } from 'react-native';
import { useToast } from '../../../context/ToastContext';

const AddMembersModal: React.FC = () => {
  const { config } = useChatSettingState();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));

  const dispatch = useAppDispatch();
  const { client } = useXmppClient();
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [userName, setUserName] = useState('');

  const handleOpenModal = () => setIsModalOpen(true);
  const handleCloseModal = () => setIsModalOpen(false);

  const validateRoomName = (name: string) => {
    if (name.trim().length < 3) {
      return 'Room name must be at least 3 characters.';
    }
    return '';
  };

  const handleAddUser = async () => {
    try {
      if(!activeRoom) return;
      
      await postAddRoomMember({
        chatName: activeRoom.jid.split('@')[0],
        members: [userName],
      });
      handleCloseModal();
      await client.inviteRoomRequestStanza(userName, activeRoom.jid);

      const room = await getRoomByName(activeRoom.jid);
      const createdRoom = createRoomFromApi(room, config?.xmppSettings?.conference);
      if (createdRoom) {
        dispatch(
          addRoomViaApi({
            room: createdRoom,
            xmpp: client,
          })
        );
      }

      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: `${userName} has been added to the room.`,
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to add user:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to add user.',
        type: 'error',
      });
    }
  };

  const handleUserNameChange = (text: string) => {
    setUserName(text);
  };

  return (
    <>
      <ActionButton variant="filled" unstyled onPress={handleOpenModal}>
        Add members
      </ActionButton>

      {isModalOpen && (
        <ModalBackground>
          <ModalContainer>
            <CloseButton onPress={handleCloseModal}>
              <Text style={{ fontSize: 24 }}>&times;</Text>
            </CloseButton>
            <ModalTitle>Add New Member</ModalTitle>
            <GroupContainer
              style={{
                flexDirection: 'column',
                position: 'relative',
                width: '100%',
              }}
            >
              <InputWithLabel
                style={{ flex: 1 }}
                id="userName"
                value={userName}
                onChange={handleUserNameChange}
                placeholder="Enter User Id"
              />
            </GroupContainer>

            <GroupContainer>
              <Button
                onPress={handleCloseModal}
                text={'Cancel'}
                style={{ width: '100%' }}
                unstyled
                variant="outlined"
              />
              <Button
                onPress={handleAddUser}
                text={'Add'}
                style={{ width: '100%' }}
                unstyled
                variant="filled"
              />
            </GroupContainer>
          </ModalContainer>
        </ModalBackground>
      )}
    </>
  );
};

export default AddMembersModal;
