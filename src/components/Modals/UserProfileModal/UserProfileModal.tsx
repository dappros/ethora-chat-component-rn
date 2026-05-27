import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CenterContainer,
  UserInfo,
  UserName,
  UserStatus,
  ModalContainerFullScreen,
  ActionButton,
  Label,
  BorderedContainer,
  LabelData,
  ModalBackground,
  ModalContainer,
  CloseButton,
  ModalTitle,
  GroupContainer,
} from '../styledModalComponents';
import { ChatIcon, DeleteIcon, DownloadIcon, EditIcon, IconDoc, LeaveIcon, MoreIcon } from '../../../assets/icons';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { useSelector } from 'react-redux';
import { RootState } from '../../../roomStore';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import Button from '../../styled/Button';
import DropdownMenu from '../../DropdownMenu/DropdownMenu';
import {
  logout,
  setActiveModal,
  setLangSource,
  setSelectedUser,
} from '../../../roomStore/chatSettingsSlice';
import { addRoomViaApi, setCurrentRoom, setLogoutState } from '../../../roomStore/roomsSlice';
import EditUserModal from './EditUserModal';
import { walletToUsername } from '../../../helpers/walletUsername';
import { useXmppClient } from '../../../context/xmppProvider';
import Loader from '../../styled/Loader';
import { IRoom, Iso639_1Codes } from '../../../types/types';
import Select from '../../MainComponents/Select';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { ScrollView, Text, View } from 'react-native';
import { ApiRoom, postPrivateRoom } from '../../../networking/api-requests/rooms.api';
import { createRoomFromApi } from '../../../helpers/createRoomFromApi';
import { useToast } from '../../../context/ToastContext';
import { LANGUAGE_OPTIONS } from '../../../helpers/constants/LANGUAGE_OPTIONS';
import { deleteDocument, getDocuments } from '../../../networking/api-requests/user.api';
import { useChatSettingState } from '../../../hooks/useChatSettingState';

interface UserProfileModalProps {
  handleCloseModal: any;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useAppDispatch();

  const { client } = useXmppClient();
  const { showToast } = useToast();

  const { config, user, selectedUser, langSource } = useChatSettingState();

  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [documents, setDocuments] = useState<any[]>([]);
  const [deleteDocumentId, setDeleteDocumentId] = useState<string>('');
  const [showDelete, setShowDelete] = useState<boolean>(false);

  const handleDeleteDocument = async () => {
    try {
      await deleteDocument(deleteDocumentId);
      setDocuments(documents.filter((doc) => doc._id !== deleteDocumentId));
      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: 'Document deleted successfully',
        type: 'success',
      });
      // handleGetDocs();
    } catch (error) {
      console.error('Error deleting document', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to delete document',
        type: 'error',
      });
    } finally {
      setShowDelete(false);
    }
  };

  const handleGetDocs = async () => {
    try {
      const { data } = await getDocuments(user?.defaultWallet?.walletAddress);
      const items = data.results.filter((el: {locations: unknown[]}) => el.locations[0]);

      setDocuments(items);
    } catch (error) {
      console.error('Error getting docs', error);
    }
  };

  useEffect(() => {
    handleGetDocs();
  }, []);

  const handleBackClick = useCallback(() => {
    dispatch(setSelectedUser(undefined));
    handleCloseModal();
  }, []);

  const handleLogout = useCallback(() => {
    dispatch(logout());
    dispatch(setLogoutState());
  }, []);

  const menuOptions = useMemo(
    () => [
      {
        label: 'Log Out',
        icon: <LeaveIcon />,
        onClick: () => {
          handleLogout();
        },
        styles: { color: 'red' },
      },
    ],
    []
  );

  const handleSelect = (selected: { name: string; id: Iso639_1Codes }) => {
    dispatch(setLangSource(selected.id));
  };

  const EditClick = useCallback(() => {
    setIsEditing(true);
  }, []);


  const handleRoomCreation = async (
    newChat: ApiRoom,
    usersArrayLength: number
  ) => {
    try {
      const normalizedChat = createRoomFromApi(
        newChat,
        config?.xmppSettings?.conference,
        usersArrayLength
      );

      if (!normalizedChat || !client) return;

      dispatch(
        addRoomViaApi({
          room: normalizedChat,
          xmpp: client,
        })
      );

      dispatch(setCurrentRoom({ roomJID: normalizedChat?.jid || '' }));

      showToast({
        id: Date.now().toString(),
        title: 'Success!',
        message: 'Room created succusfully!',
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Error handling room creation:', error);
    }
  };

  const handlePrivateMessage = useCallback(async () => {
    showToast({
      id: Date.now().toString(),
      title: 'Room creation',
      message: 'Room is being created...',
      type: 'info',
      duration: 3000,
    });
    let newRoomJid = '';
    if (config?.newArch) {
      const newRoom = await postPrivateRoom(
        selectedUser?.userJID ?? (selectedUser?.id || '')
      );
      handleRoomCreation(newRoom, 2);
      newRoomJid = newRoom.name;
    } else {
      const selectedUserUsername = walletToUsername(selectedUser?.id || '');
      const myUsername = walletToUsername(user.defaultWallet.walletAddress);

      const combinedWalletAddress = [myUsername, selectedUserUsername]
        .sort()
        .join('.');

      const roomJid = combinedWalletAddress.toLowerCase();

      const combinedUsersName = [
        user.firstName,
        selectedUser?.name?.split(' ')?.[0] || '',
      ]
        .sort()
        .join(' and ');

      newRoomJid = (await client?.createPrivateRoomStanza(
        combinedUsersName,
        `Private chat ${combinedUsersName}`,
        roomJid
      )) || '';

      if (newRoomJid) {
        await client?.inviteRoomRequestStanza(selectedUserUsername, newRoomJid);
        await client?.getRoomsStanza();
      }
    }

    dispatch(setActiveModal(undefined));
  }, [selectedUser]);

  const modalUser: any = selectedUser ?? user;

  const findLanguage = () => {
    if(!langSource) {return null;}

    const language = LANGUAGE_OPTIONS.find((lang) => lang.id === langSource);
    return language || null;
  };

  const showDeleteModal = (docId: string) => {
    setDeleteDocumentId(docId);
    setShowDelete(true);
  };

  const DefaultBody = useMemo(
    () => (
      <>
        <ModalHeaderComponent
          handleCloseModal={handleBackClick}
          headerTitle={'Profile'}
          rightMenu={
            !selectedUser && (
              <>
                <Button onPress={EditClick}>
                  <EditIcon color="#8C8C8C" />
                </Button>
                <DropdownMenu
                  options={menuOptions}
                  position="right"
                  menuIcon={<MoreIcon />}
                />
              </>
            )
          }
        />
        <CenterContainer>
          <ProfileImagePlaceholder
            icon={modalUser?.profileImage ?? null}
            name={modalUser?.name ?? modalUser?.firstName}
            size={120}
          />
          <UserInfo>
            <UserName>
              {modalUser?.name
                ? `${modalUser?.name}`
                : `${modalUser?.firstName} ${modalUser?.lastName}`}
            </UserName>
            {/* <UserStatus>Status</UserStatus> */}
          </UserInfo>
          {!selectedUser && config?.translates?.enabled && (
            <BorderedContainer>
              <Select
                options={LANGUAGE_OPTIONS}
                placeholder={'Select your language'}
                onSelect={handleSelect}
                accentColor={config?.colors?.primary}
                selectedValue={findLanguage()}
              />
            </BorderedContainer>
          )}
          <BorderedContainer>
            <Label>About</Label>
            <LabelData>
              {modalUser?.description && modalUser?.description?.length > 4
                ? modalUser.description
                : 'No description'}
            </LabelData>
          </BorderedContainer>

          {selectedUser && !config?.disableProfilesInteractions && (
            <>
              <ActionButton
                StartIcon={<ChatIcon />}
                onPress={handlePrivateMessage}
                variant="filled"
              >
                <Text style={{ color: '#ffffff' }}>Message</Text>
              </ActionButton>
              <ActionButton
                onPress={() => {}}
                // onPress={() => handleCopyClick(selectedUser.id)}
                variant="filled"
              >
                <Text style={{ color: '#ffffff' }}>Copy User Id</Text>
              </ActionButton>
            </>
          )}

          <BorderedContainer>
            <ScrollView
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
            {documents.map((doc) => (
              <View
                key={doc._id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 24,
                  backgroundColor: '#F3F6FC',
                  marginBottom: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 16,
                  borderRadius: 8,
                }}
              >
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 24,
                }}>
                <View><IconDoc/></View>
                <View>
                  <Label style={{ paddingBottom: 4 }}>{doc.documentName}</Label>
                  <LabelData>
                    {new Date(doc.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' + new Date(doc.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </LabelData>
                </View>
                </View>
                <Button onPress={() => showDeleteModal(doc._id)}>
                  <DeleteIcon/>
                </Button>
              </View>
            ))}
            </ScrollView>
          </BorderedContainer>


          {/* <EmptySection /> */}
        </CenterContainer>
      </>
    ),
    [modalUser, documents]
  );

  const EditingBody = useMemo(
    () => (
      <EditUserModal
        setIsEditing={setIsEditing}
        modalUser={modalUser}
        config={config}
      />
    ),
    [modalUser]
  );

  return (
    <>
      <ModalContainerFullScreen>
        {!isEditing ? DefaultBody : EditingBody}
      </ModalContainerFullScreen>

      {showDelete && (
        <ModalBackground style={{ position: 'absolute', zIndex: 9999 }}>
          <ModalContainer>
            <CloseButton onPress={() => setShowDelete(false)}>
              <Text style={{ fontSize: 24 }}>&times;</Text>
            </CloseButton>
            <ModalTitle>Delete this document?</ModalTitle>

            <GroupContainer>
              <Button
                onPress={() => setShowDelete(false)}
                text={'Cancel'}
                style={{ width: '100%' }}
                unstyled
                variant="filled"
                color="white"
              />
              <Button
                onPress={handleDeleteDocument}
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
      )}
    </>
  );
};

export default UserProfileModal;
