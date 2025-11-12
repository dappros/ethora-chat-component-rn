import React, { useState } from 'react';
import Button from '../../styled/Button';
import { useDispatch, useSelector } from 'react-redux';
import { getActiveRoom, RootState } from '../../../roomStore';
import {
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalTitle,
} from '../styledModalComponents';
import { deleteRoom as deleteRoomApi } from '../../../networking/api-requests/rooms.api';
import { deleteRoom as deleteRoomAction } from '../../../roomStore/roomsSlice';
import { Text } from 'react-native';
import { useToast } from '../../../context/ToastContext';

interface DeleteChatModalProps {
  isModalOpen: boolean;
  setIsModalOpen: (isOpen: boolean) => void;
}

const DeleteChatModal: React.FC<DeleteChatModalProps> = ({
  isModalOpen,
  setIsModalOpen,
}) => {
  const dispatch = useDispatch();
  const { showToast } = useToast();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));

  const handleOpenModal = () => setIsModalOpen(true);
  const handleCloseModal = () => setIsModalOpen(false);

  const handleDeleteChat = async () => {
    try {
      await deleteRoomApi(activeRoom?.jid?.split('@')[0] || '');
      dispatch(deleteRoomAction({ jid: activeRoom?.jid || '' }));
      handleCloseModal();
      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: 'Chat deleted successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to delete chat:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to delete chat',
        type: 'error',
      });
    }
  };

  return (
    isModalOpen && (
      <ModalBackground>
        <ModalContainer>
          <CloseButton onPress={handleCloseModal}>
            <Text style={{ fontSize: 24 }}>&times;</Text>
          </CloseButton>
          <ModalTitle>Delete this chat ?</ModalTitle>

          <GroupContainer>
            <Button
              onPress={handleCloseModal}
              text={'Cancel'}
              style={{ width: '100%' }}
              unstyled
              variant="filled"
            />
            <Button
              onPress={handleDeleteChat}
              text={'Delete'}
              style={{
                width: '100%',
                borderWidth: 1,
                borderColor: 'red',
            }}
              color="red"
              unstyled
              variant="outlined"
            />
          </GroupContainer>
        </ModalContainer>
      </ModalBackground>
    )
  );
};

export default DeleteChatModal;
