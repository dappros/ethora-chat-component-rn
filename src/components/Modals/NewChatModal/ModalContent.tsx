import React from 'react';
import {
  ModalContainer,
  CloseButton,
  ModalTitle,
  GroupContainer,
} from '../styledModalComponents';
import InputWithLabel from '../../styled/StyledInput';
import Select from '../../MainComponents/Select';
import Button from '../../styled/Button';
import UsersList from '../../UsersList/UsersList';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { ChatAccessOption } from '../../../types/types';
import { AddPhotoIcon } from '../../../assets/icons';
import { Text } from 'react-native';

type ModalContentProps = {
  activeTab: '0' | '1' | null;
  roomName: string;
  roomDescription: string;
  chatType: ChatAccessOption;
  profileImage: string | File | null;
  setActiveTab: (tab: '0' | '1' | null) => void;
  handleRoomNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  setRoomDescription: (description: string) => void;
  setChatType: (type: ChatAccessOption) => void;
  setProfileImage: (image: string | File | null) => void;
  selectedUsers: any[];
  setSelectedUsers: (users: any[]) => void;
  handleCreateRoom: () => void;
  handleCloseModal: () => void;
  errors: { name: string; description: string };
  setErrors: (errors: { name: string; description: string }) => void;
  options: ChatAccessOption[];
};

const ModalContent: React.FC<ModalContentProps> = ({
  activeTab,
  roomName,
  roomDescription,
  chatType,
  profileImage,
  setActiveTab,
  handleRoomNameChange,
  setChatType,
  setProfileImage,
  selectedUsers,
  setSelectedUsers,
  handleCreateRoom,
  handleCloseModal,
  errors,
  setErrors,
  options,
}) => {
  return (
    <ModalContainer>
      <CloseButton onPress={handleCloseModal}>
        <Text style={{ fontSize: 24 }}>&times;</Text>
      </CloseButton>
      {activeTab === '0' && (
        <>
          <ModalTitle>Create New Chat</ModalTitle>
          <ProfileImagePlaceholder
            size={120}
            upload={{ active: true, onUpload: setProfileImage }}
            remove={{
              enabled: true,
              onRemoveClick: () => setProfileImage(null),
            }}
            placeholderIcon={<AddPhotoIcon />}
            icon={profileImage}
            disableOverlay={!profileImage}
            role="user"
          />
          <GroupContainer
            style={{
              flexDirection: 'column',
              position: 'relative',
              width: '100%',
            }}
          >
            <InputWithLabel
              style={{ flex: 1 }}
              id="roomName"
              value={roomName}
              onChange={handleRoomNameChange}
              placeholder="Enter Room Name"
              helperText={errors.name}
              error={!!errors.name}
            />
            <Select
              options={options}
              onSelect={setChatType}
              selectedValue={chatType}
              placeholder={'Select room type'}
            />
          </GroupContainer>
          {chatType.id === 'group' && (
            <Button
              onPress={() => setActiveTab('1')}
              style={{ width: '100%' }}
              variant="outlined"
              unstyled
            >
              Add users
            </Button>
          )}
          <GroupContainer>
            <Button
              onPress={handleCloseModal}
              text={'Cancel'}
              style={{ width: '100%' }}
              unstyled
              variant="outlined"
            />
            <Button
              onPress={handleCreateRoom}
              text={'Create'}
              style={{ width: '100%' }}
              variant="filled"
            />
          </GroupContainer>
        </>
      )}
      {activeTab === '1' && (
        <>
          <ModalTitle>Select users to add to Chat</ModalTitle>
          <UsersList
            selectedUsers={selectedUsers}
            setSelectedUsers={setSelectedUsers}
            style={{
              minHeight: '400px',
              minWidth: '100%',
              width: '100%',
            }}
          />
          <Button
            onPress={() => setActiveTab('0')}
            style={{ width: '100%' }}
            variant="outlined"
            unstyled
          >
            Back to creation
          </Button>
        </>
      )}
    </ModalContainer>
  );
};

export default ModalContent;
