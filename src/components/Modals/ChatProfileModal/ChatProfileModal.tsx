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
import { Pressable, View, Text, ScrollView, Alert, Linking } from 'react-native';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { useDispatch, useSelector } from 'react-redux';
import { RootState, getActiveRoom } from '../../../roomStore';
import { uploadFile } from '../../../networking/api-requests/auth.api';
import { useXmppClient } from '../../../context/xmppProvider';
import { updateRoom } from '../../../roomStore/roomsSlice';
import * as ImagePicker from 'expo-image-picker';
import Loader from '../../styled/Loader';
import Button from '../../styled/Button';
import { DeleteIcon, MoreIcon, QrIcon } from '../../../assets/icons';
import Switch from '../../MainComponents/Switch';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
import { getElementFont } from '../../../helpers/getElementFont';
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
  const { user: stateUser, config } = useChatSettingState();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));

  // Pull live member list from the MUC when the modal opens — REST
  // hydration only fills the *count* (item.participants /
  // item.members.length); the actual roster comes from a `getRoomMembers`
  // IQ which onGetMembers in stanzaHandlers parses into `roomMembers`.
  useEffect(() => {
    if (client && activeRoom?.jid) {
      try {
        client.getRoomMembersStanza?.(activeRoom.jid);
      } catch {
        /* non-fatal */
      }
    }
  }, [client, activeRoom?.jid]);

  const onUpload = async () => {
    let loadingSet = false;
    try {
      setLoading(true);
      loadingSet = true;

      // expo-image-picker owns the permission prompt internally and
      // returns a `granted` flag. No separate react-native-permissions
      // round-trip needed.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission required',
          'Photo library permission is needed to select images.',
          [
            {
              text: 'Cancel',
              onPress: () => setLoading(false),
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

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      const asset = result.assets[0];
      const originalName = asset.fileName || asset.uri.split('/').pop();
      const fileObject = {
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
        name: originalName || `profile_${Date.now()}.jpg`,
      };

      const mediaData = new FormData();
      mediaData.append('files', fileObject as any);

      const uploadResult = await uploadFile(mediaData);
      const location = uploadResult?.data?.results?.[0]?.location;

      if (location) {
        client?.setRoomImageStanza(activeRoom?.jid || '', location, 'icon', 'none');
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
            roomMembers: activeRoom?.roomMembers?.filter(
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
    client?.setRoomImageStanza(activeRoom?.jid || '', '', 'icon', 'none');
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
        token: '',
        refreshToken: '',
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
      dispatch(setActiveModal(undefined));
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
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
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
          // Two gates control whether the icon is editable:
          //   1. role — only non-participants could edit before.
          //   2. NEW: `disableChatInfo.disableIconEdit` — hard kill from
          //      config so a consumer can make the icon read-only for
          //      everyone (e.g. branded rooms, patient-facing apps).
          // Both must allow it for the picker/remove affordances to show.
          upload={{
            onUpload,
            active:
              !config?.disableChatInfo?.disableIconEdit &&
              activeRoom?.role !== 'participant',
          }}
          remove={{
            enabled: !config?.disableChatInfo?.disableIconEdit,
            onRemoveClick,
          }}
          role={activeRoom?.role}
          size={128}
        />
        <UserInfo>
          <UserName
            fontSize={config?.typography?.profile?.title?.fontSize}
            fontWeight={config?.typography?.profile?.title?.fontWeight as any}
          >
            {activeRoom.title || activeRoom.name}
          </UserName>
          <UserStatus style={getElementFont(config, 'profileStatus')}>
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
        {!config?.disableChatInfo?.disableDescription && (
          <BorderedContainer>
            <LabelData style={getElementFont(config, 'profileSectionLabel')}>
              Description
            </LabelData>
            <Label>{activeRoom?.description || '—'}</Label>
          </BorderedContainer>
        )}
        {!config?.disableChatInfo?.disableType && (
          <BorderedContainer>
            <LabelData style={getElementFont(config, 'profileSectionLabel')}>
              Chat type
            </LabelData>
            <Label>{activeRoom.type || '—'}</Label>
          </BorderedContainer>
        )}
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
        {!config?.disableChatInfo?.hideMembers && (
        <BorderedContainer style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          {loading ? (
            <Loader />
          ) : (activeRoom?.roomMembers?.length ?? 0) === 0 ? (
            <Label style={{ opacity: 0.6, textAlign: 'center', paddingVertical: 8 }}>
              Member list unavailable
            </Label>
          ) : (
            <ScrollView
              style={{ maxHeight: 400 }}
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
            >
              {activeRoom?.roomMembers?.map((user, index) => (
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
                      // `disableChatInfo.disableMemberTap` blocks the
                      // tap entirely so the user-profile popup never
                      // opens. `disableMemberProfileActions` only hid
                      // the action buttons INSIDE that popup, leaving
                      // the popup itself to open on tap — this gate
                      // closes the door. Customer-reported #16.
                      onPress={
                        config?.disableChatInfo?.disableMemberTap
                          ? undefined
                          : () => handleUserAvatarClick(user)
                      }
                      disabled={!!config?.disableChatInfo?.disableMemberTap}
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
                        <Label
                          style={[
                            { fontSize: 16, fontWeight: 600 },
                            chatTextStyle(config?.typography?.profile?.memberName),
                          ]}
                        >
                          {user.firstName} {user.lastName}
                        </Label>
                        {user.last_active && (
                          <LabelData style={getElementFont(config, 'profileSectionLabel')}>
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
                  {index < (activeRoom?.roomMembers?.length || 0) - 1 && <Divider />}
                </View>
              ))}
            </ScrollView>
          )}
        </BorderedContainer>
        )}
      </CenterContainer>

      <DeleteChatModal
        isModalOpen={isModalOpen}
        setIsModalOpen={setIsModalOpen}
      />
    </ModalContainerFullScreen>
  );
};

export default ChatProfileModal;
