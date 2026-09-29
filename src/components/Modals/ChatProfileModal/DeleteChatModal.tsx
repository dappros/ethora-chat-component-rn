import React, { useState } from 'react';
import Button from '../../styled/Button';
import { useDispatch, useSelector } from 'react-redux';
import { getActiveRoom, RootState } from '../../../roomStore';
import {
  CloseButton,
  CloseButtonText,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalTitle,
} from '../styledModalComponents';
import { deleteRoom as deleteRoomApi } from '../../../networking/api-requests/rooms.api';
import { deleteRoom as deleteRoomAction } from '../../../roomStore/roomsSlice';
import { useToast } from '../../../context/ToastContext';
import { useTheme } from '../../../hooks/useTheme';
import { useT } from '../../../i18n/useT';

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
  const theme = useTheme();
  const t = useT();
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
        title: t('toast.successTitle'),
        message: t('toast.chatDeletedSuccess'),
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to delete chat:', error);
      showToast({
        id: Date.now().toString(),
        title: t('toast.error'),
        message: t('toast.failedToDeleteChat'),
        type: 'error',
      });
    }
  };

  return (
    isModalOpen && (
      <ModalBackground>
        <ModalContainer>
          <CloseButton onPress={handleCloseModal}>
            <CloseButtonText>&times;</CloseButtonText>
          </CloseButton>
          <ModalTitle>{t('modal.deleteChat.title')}</ModalTitle>

          <GroupContainer>
            <Button
              onPress={handleCloseModal}
              text={t('action.cancel')}
              style={{ width: '100%' }}
              unstyled
              variant="filled"
            />
            <Button
              onPress={handleDeleteChat}
              text={t('action.delete')}
              style={{
                width: '100%',
                borderWidth: 1,
                borderColor: theme.danger,
            }}
              color={theme.danger}
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
