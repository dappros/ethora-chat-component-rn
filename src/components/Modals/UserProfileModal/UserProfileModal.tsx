import React, { useCallback, useMemo, useState } from "react";
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
} from "../styledModalComponents";
import { ChatIcon, EditIcon, LeaveIcon, MoreIcon } from "../../../assets/icons";
import ModalHeaderComponent from "../ModalHeaderComponent";
import { useSelector } from "react-redux";
import { RootState } from "../../../roomStore";
import { ProfileImagePlaceholder } from "../../MainComponents/ProfileImagePlaceholder";
import Button from "../../styled/Button";
import DropdownMenu from "../../DropdownMenu/DropdownMenu";
import {
  logout,
  setActiveModal,
  setLangSource,
  setSelectedUser,
} from "../../../roomStore/chatSettingsSlice";
import { addRoomViaApi, setCurrentRoom, setLogoutState } from "../../../roomStore/roomsSlice";
import EditUserModal from "./EditUserModal";
import { walletToUsername } from "../../../helpers/walletUsername";
import { useXmppClient } from "../../../context/xmppProvider";
import Loader from "../../styled/Loader";
import { ApiRoom, IRoom, Iso639_1Codes } from "../../../types/types";
import Select from "../../MainComponents/Select";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { Text } from "react-native";
import { postPrivateRoom } from "../../../networking/api-requests/rooms.api";
import { createRoomFromApi } from "../../../helpers/createRoomFromApi";
import { useToast } from "../../../context/ToastContext";
import { LANGUAGE_OPTIONS } from "../../../helpers/constants/LANGUAGE_OPTIONS";

interface UserProfileModalProps {
  handleCloseModal: any;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useAppDispatch();

  const { client } = useXmppClient();
  const { showToast } = useToast();

  const { config, user, selectedUser, langSource } = useSelector(
    (state: RootState) => state.chatSettingStore
  );

  const [isEditing, setIsEditing] = useState<boolean>(false);

  const languageOptions: { name: string; id: Iso639_1Codes }[] = [
    { name: "English", id: "en" },
    { name: "Spanish", id: "es" },
    { name: "Portuguese", id: "pt" },
    { name: "Haitian Creole", id: "ht" },
    { name: "Chinese", id: "zh" },
  ];

  const handleBackClick = useCallback(() => {
    dispatch(setSelectedUser());
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

      dispatch(
        addRoomViaApi({
          room: normalizedChat as IRoom,
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

      newRoomJid = await client.createPrivateRoomStanza(
        combinedUsersName,
        `Private chat ${combinedUsersName}`,
        roomJid
      );

      if (newRoomJid) {
        await client.inviteRoomRequestStanza(selectedUserUsername, newRoomJid);
        await client.getRoomsStanza();
      }
    }

    dispatch(setActiveModal());
  }, [selectedUser]);

  const modalUser: any = selectedUser ?? user;

  const findLanguage = () => {
    if(!langSource) return null;
    
    const language = LANGUAGE_OPTIONS.find((lang) => lang.id === langSource);
    return language || null;
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
          {selectedUser && (
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
          {/* <EmptySection /> */}
        </CenterContainer>
      </>
    ),
    [modalUser]
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
    <ModalContainerFullScreen>
      {!isEditing ? DefaultBody : EditingBody}
    </ModalContainerFullScreen>
  );
};

export default UserProfileModal;
