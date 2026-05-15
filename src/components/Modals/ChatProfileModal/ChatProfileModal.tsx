import React, { useEffect, useMemo, useState } from 'react';
import {
  CenterContainer,
  UserInfo,
  UserName,
  UserStatus,
  ModalContainerFullScreen,
  Label,
  BorderedContainer,
  LabelData,
  Viewider,
  Divider,
} from '../styledModalComponents';
import { Pressable, View, Text, ScrollView, Alert, Linking, Platform } from 'react-native';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, getActiveRoom } from '../../../roomStore';
import { uploadFile } from '../../../networking/api-requests/auth.api';
import { useXmppClient } from '../../../context/xmppProvider';
import { updateRoom } from '../../../roomStore/roomsSlice';
import ImagePicker from 'react-native-image-crop-picker';
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  Permission,
} from 'react-native-permissions';
import Loader from '../../styled/Loader';
import Button from '../../styled/Button';
import { DeleteIcon, MoreIcon, QrIcon } from '../../../assets/icons';
import Switch from '../../MainComponents/Switch';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { deleteRoomMember } from '../../../networking/api-requests/rooms.api';
import { RoomMember } from '../../../types/models/room.model';
import { setActiveModal, setSelectedUser } from '../../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import DropdownMenu, { MenuOption } from '../../DropdownMenu/DropdownMenu';
import SelectUsersModal from '../SelectUsersModal/SelectUsersModal';
import { useToast } from '../../../context/ToastContext';
import DeleteChatModal from './DeleteChatModal';


interface ChatProfileModalProps {
  handleCloseModal: any;
}

const ChatProfileModal: React.FC<ChatProfileModalProps> = ({
  handleCloseModal,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [visible, setVisible] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { showToast } = useToast();

  const chatMenuOptions = useMemo(
    () => [
      {
        label: 'Delete chat',
        icon: <DeleteIcon />,
        onClick: () => {
          setIsModalOpen(true);
        },
        styles: { color: 'red' },
      },
    ],
    []
  );

  const dispatch = useDispatch();

  const { client } = useXmppClient();
  const { user: stateUser } = useChatSettingState();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));

  const checkPermission = async (permission: Permission) => {
    const status = await check(permission);
    if (status === RESULTS.GRANTED) {
      return status;
    } else if (status === RESULTS.DENIED) {
      const requestStatus = await request(permission);
      return requestStatus;
    }
    return status;
  };

  const onUpload = async () => {
    let loadingSet = false;
    try {
      setLoading(true);
      loadingSet = true;

      const permission =
        Platform.OS === 'ios'
          ? PERMISSIONS.IOS.PHOTO_LIBRARY
          : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
      const permissionStatus = await checkPermission(permission);

      if (permissionStatus !== RESULTS.GRANTED) {
        Alert.alert(
          'Permission required',
          'Photo library permission is needed to select images.',
          [
            {
              text: 'Cancel',
              onPress: () => {
                setLoading(false);
                console.log('Photo permission cancelled');
              },
              style: 'cancel',
            },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
        return;
      }

      const image = await ImagePicker.openPicker({
        width: 300,
        height: 300,
        cropping: true,
        cropperCircleOverlay: true,
        compressImageQuality: 0.8,
      });

      const originalName = image.path.split('/').pop();
      const fileObject = {
        uri: image.path,
        type: image.mime || 'image/jpeg',
        name: originalName || `profile_${Date.now()}.jpg`,
      };

      const mediaData = new FormData();
      mediaData.append('files', fileObject as any);

      const uploadResult = await uploadFile(mediaData);
      const location = uploadResult?.data?.results?.[0]?.location;

      if (location) {
        client.setRoomImageStanza(activeRoom?.jid || '', location, 'icon', 'none');
        dispatch(
          updateRoom({ jid: activeRoom?.jid || '', updates: { icon: location } })
        );

        showToast({
          id: Date.now().toString(),
          title: 'Success',
          message: 'Room image updated successfully',
          type: 'success',
        });
      }
    } catch (error: any) {
      if (error?.code === 'E_PICKER_CANCELLED' || error?.code === 'E_NO_CAMERA_PERMISSION') {
        console.log('User cancelled image selection');
        return;
      }

      console.error('File upload failed or location is missing:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to upload image',
        type: 'error',
      });
    } finally {
      if (loadingSet) {
        setLoading(false);
      }
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      await deleteRoomMember({
        roomId: activeRoom?.jid?.split('@')[0] || '',
        members: [userId],
      });

      dispatch(
        updateRoom({
          jid: activeRoom?.jid || '',
          updates: {
            members: activeRoom?.members?.filter(
              (user) => user.xmppUsername !== userId
            ),
          },
        })
      );

      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: `${userId} has been removed from the room.`,
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to delete user:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to delete user.',
        type: 'error',
      });
    }
  };

  const onRemoveClick = async () => {
    client.setRoomImageStanza(activeRoom?.jid || '', '', 'icon', 'none');
    dispatch(updateRoom({ jid: activeRoom?.jid || '', updates: { icon: null } }));
  };

  const handleUserAvatarClick = (user: RoomMember): void => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    dispatch(
      setSelectedUser({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        userJID: user?.xmppUsername,
      })
    );
  };

  const menuOptions = useMemo(
    () => (userId: string) => [
      {
        label: 'Appoint as an admin',
        icon: null,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.PROFILE));
          console.log('Profile clicked');
        },
      },
      {
        label: 'Unban',
        icon: null,
        onClick: () => {
          dispatch(setActiveModal(MODAL_TYPES.SETTINGS));
          console.log('Settings clicked');
        },
      },
      {
        label: 'Delete',
        icon: null,
        onClick: (e: any) => {
          e?.preventDefault();
          handleDeleteUser(userId);
        },
      },
    ],
    []
  );

  useEffect(() => {
    if (!activeRoom) {
      dispatch(setActiveModal());
    }
  }, [activeRoom, dispatch]);

  if (!activeRoom) {
    return null;
  }

  return (
    <ModalContainerFullScreen style={{ position: 'relative' }}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={'Chat Profile'}
        rightMenu={
          <>
            {activeRoom?.type === 'public' && (
              <Button EndIcon={<QrIcon />} onPress={() => setVisible(true)} />
            )}
            {activeRoom.role === 'moderator' &&
              activeRoom.type !== 'private' && (
                <DropdownMenu
                  position="right"
                  options={chatMenuOptions}
                  openButton={
                    <Button
                      style={{ padding: 8, height: 40 }}
                      EndIcon={<MoreIcon />}
                      unstyled
                    />
                  }
                />
              )}
          </>
        }
      />
      <CenterContainer>
        <ProfileImagePlaceholder
          name={activeRoom.title || activeRoom.name}
          icon={activeRoom.icon}
          upload={{
            onUpload,
            active: activeRoom?.role !== 'participant' ? true : false,
          }}
          remove={{ enabled: true, onRemoveClick }}
          role={activeRoom?.role}
          size={128}
        />
        <UserInfo>
          <UserName>{activeRoom.title || activeRoom.name}</UserName>
          <UserStatus>
            {activeRoom.usersCnt}{' '}
            {activeRoom.usersCnt > 1 ? 'members' : 'member'}
          </UserStatus>
        </UserInfo>
        {activeRoom.role === 'moderator' && activeRoom.type === 'group' && (
          <>
            {/* <AddMembersModal /> */}
            <SelectUsersModal />
          </>
        )}
        <BorderedContainer>
          <LabelData>Description</LabelData>
          <Label>{activeRoom?.description}</Label>
        </BorderedContainer>
        <BorderedContainer>
          <LabelData>Chat type</LabelData>
          <Label>{activeRoom.type}</Label>
        </BorderedContainer>
        {/* <BorderedContainer
          style={{
            justifyContent: 'space-between',
            flexDirection: 'row',
            alignItems: 'center',
          }}
        >
          <Label>Notifications</Label>
          <Label>
            <Switch
              onToggle={function (isOn: boolean): void {
                throw new Error('Function not implemented.');
              }}
              bgColor={config?.colors?.primary}
            />
          </Label>
        </BorderedContainer> */}
        <BorderedContainer style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          {loading ? (
            <Loader />
          ) : (
            <ScrollView
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              {activeRoom?.members?.map((user, index) => (
                <View
                  key={user.xmppUsername}
                  style={{
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                  }}
                >
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'flex-start',
                      paddingHorizontal: 8,
                      paddingVertical: 0,
                      alignItems: 'center',
                      width: '100%',
                    }}
                  >
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 16 }}
                      onPress={() => handleUserAvatarClick(user)}
                    >
                      <ProfileImagePlaceholder
                        name={`${user.firstName} ${user.lastName}`}
                        size={40}
                      />
                      <View
                        style={{
                          flexDirection: 'column',
                          gap: 2,
                          alignItems: 'flex-start',
                          justifyContent: 'center',
                        }}
                      >
                        <Label style={{ fontSize: 16, fontWeight: 600 }}>
                          {user.firstName} {user.lastName}
                        </Label>
                        {user.last_active && (
                          <LabelData>
                            {new Date(user.last_active * 1000).toLocaleString()}
                          </LabelData>
                        )}
                      </View>
                    </Pressable>
                    {user.role && user.role !== 'none' && (
                      <Text
                        style={{
                          backgroundColor:
                            user.ban_status !== 'banned' ? '#F3F6FC' : '#FFEBEE',
                          color:
                            user.ban_status !== 'banned' ? '#0052CD' : '#F44336',
                          padding: 5,
                          borderRadius: 16,
                          fontSize: 12,
                        }}
                      >
                        {user.role}
                      </Text>
                    )}
                    {stateUser.xmppUsername !== user.xmppUsername &&
                      activeRoom.role === 'moderator' &&
                      activeRoom.type !== 'private' && (
                        <DropdownMenu
                          options={menuOptions(user.xmppUsername) as MenuOption[]}
                          openButton={
                            <Button
                            onPress={() => {}}
                            >
                              <Text>More Options</Text>
                            </Button>
                          }
                          onClose={() => console.log('Dropdown closed')}
                        />
                      )}
                  </View>
                  {index < (activeRoom?.members?.length || 0) - 1 && <Divider />}
                </View>
              ))}
            </ScrollView>
          )}
        </BorderedContainer>
      </CenterContainer>

      <DeleteChatModal
        isModalOpen={isModalOpen}
        setIsModalOpen={setIsModalOpen}
      />
    </ModalContainerFullScreen>
  );
};

export default ChatProfileModal;
