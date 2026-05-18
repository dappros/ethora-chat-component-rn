// Modal-id → component registry. Split out from MODAL_TYPES.ts to
// break the require cycle between the type constants and the modal
// components that reference them. The only caller is Modal/Modal.tsx
// — every other consumer just needs MODAL_TYPES.

import React from 'react';
import { MODAL_TYPES } from './MODAL_TYPES';
import ChatProfileModal from '../../components/Modals/ChatProfileModal/ChatProfileModal';
import FilePreviewModal from '../../components/Modals/FilePreviewModal/FilePreviewModal';
import NewChatModal from '../../components/Modals/NewChatModal/NewChatModal';
import BlockedUsersModal from '../../components/Modals/SettingsModals/BlockedUsers/BlockedUsersModal';
import DocumentSharesModal from '../../components/Modals/SettingsModals/DocumentShares/DocumentSharesModal';
import ManageDataModal from '../../components/Modals/SettingsModals/ManageDataModal/ManageDataModal';
import ProfileSharesModal from '../../components/Modals/SettingsModals/ProfileShares/ProfileShares';
import ReferralsModal from '../../components/Modals/SettingsModals/Referrals/Referrals';
import VisibilityModal from '../../components/Modals/SettingsModals/Visibility/VisibilityModal';
import UserProfileModal from '../../components/Modals/UserProfileModal/UserProfileModal';
import UserSettingsModal from '../../components/Modals/UserSettingsModal/UserSettingsModal';

export const MODAL_COMPONENTS: Record<
  string,
  React.FC<{ handleCloseModal: () => void }>
> = {
  [MODAL_TYPES.SETTINGS]: UserSettingsModal,
  [MODAL_TYPES.NEW_CHAT]: NewChatModal,
  [MODAL_TYPES.PROFILE]: UserProfileModal,
  [MODAL_TYPES.CHAT_PROFILE]: ChatProfileModal,
  [MODAL_TYPES.MANAGE_DATA]: ManageDataModal,
  [MODAL_TYPES.VISIBILITY]: VisibilityModal,
  [MODAL_TYPES.REFERRALS]: ReferralsModal,
  [MODAL_TYPES.DOCUMENT_SHARES]: DocumentSharesModal,
  [MODAL_TYPES.PROFILE_SHARES]: ProfileSharesModal,
  [MODAL_TYPES.BLOCKED_USERS]: BlockedUsersModal,
  [MODAL_TYPES.FILE_PREVIEW]: FilePreviewModal,
};
