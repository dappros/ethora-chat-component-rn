import React from 'react';
import { ModalBackground } from '../styledModalComponents';
import { ModalType } from '../../../types/types';
import { useDispatch } from 'react-redux';
import {
  setActiveModal,
  setSelectedUser,
} from '../../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import { MODAL_COMPONENTS } from '../../../helpers/constants/MODAL_COMPONENTS';
import { SwipeBackLayer } from './SwipeBackLayer';

interface ModalProps {
  children?: React.ReactNode;
  modal?: string;
  setOpenModal: (value?: ModalType) => any;
}

const Modal: React.FC<ModalProps> = ({ children, modal, setOpenModal }) => {
  const dispatch = useDispatch();
  const handleCloseModal = () => setOpenModal();
  const handleBackButtonClick = () =>
    dispatch(setActiveModal(MODAL_TYPES.SETTINGS));

  const renderModalContent = () => {
    if (!modal) {return null;}

    const ModalComponent = MODAL_COMPONENTS[modal];

    if (!ModalComponent) {return null;}

    const handleClose =
      modal === MODAL_TYPES.MANAGE_DATA ||
      modal === MODAL_TYPES.VISIBILITY ||
      modal === MODAL_TYPES.REFERRALS ||
      modal === MODAL_TYPES.DOCUMENT_SHARES ||
      modal === MODAL_TYPES.PROFILE_SHARES ||
      modal === MODAL_TYPES.BLOCKED_USERS
        ? handleBackButtonClick
        : handleCloseModal;

    return <ModalComponent handleCloseModal={handleClose} />;
  };
  // Modals that present themselves (a real RN <Modal>, so the dim covers
  // the whole window rather than stopping at this component's frame) must
  // not also sit inside the shared in-tree backdrop — that would dim twice.
  if (modal === MODAL_TYPES.NEW_CHAT) {
    return <>{renderModalContent()}{children}</>;
  }

  // The profile screens are full-screen pages rather than dialogs: they
  // slide in and can be swiped back from the left edge, like a room. One
  // layer serves both, so going chat profile → member profile swaps the
  // page in place instead of replaying the entrance.
  if (modal === MODAL_TYPES.PROFILE || modal === MODAL_TYPES.CHAT_PROFILE) {
    const ProfileComponent = MODAL_COMPONENTS[modal];
    if (ProfileComponent) {
      return (
        <SwipeBackLayer
          onClose={() => {
            // The viewed member is cleared only once the page is gone, so
            // it doesn't flip to the user's own profile mid-slide.
            dispatch(setSelectedUser(undefined));
            setOpenModal();
          }}
        >
          {(close) => (
            <>
              <ProfileComponent handleCloseModal={close} />
              {children}
            </>
          )}
        </SwipeBackLayer>
      );
    }
  }

  return (
    modal && (
      <ModalBackground
        id="modal-background"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        {renderModalContent()}
        {children}
      </ModalBackground>
    )
  );
};

export default Modal;
