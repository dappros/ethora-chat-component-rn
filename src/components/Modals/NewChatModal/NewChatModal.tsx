import React, { useState, useEffect, useMemo } from "react";
import Button from "../../styled/Button";
import { AddNewIcon, AddPhotoIcon } from "../../../assets/icons";
import { RootState } from "../../../roomStore";
import { useXmppClient } from "../../../context/xmppProvider";
import {
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalTitle,
} from "../styledModalComponents";
import { addRoomViaApi, setCurrentRoom, updateRoom } from "../../../roomStore/roomsSlice";
import InputWithLabel from "../../styled/StyledInput";
import { uploadFile } from "../../../networking/api-requests/auth.api";
import { ProfileImagePlaceholder } from "../../MainComponents/ProfileImagePlaceholder";
import { Text, Alert, Linking, Platform } from "react-native";
import ImagePicker from "react-native-image-crop-picker";
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  Permission,
} from "react-native-permissions";
import { ApiRoom, ChatAccessOption, RoomMember } from "../../../types/models/room.model";
import { createRoomFromApi } from "../../../helpers/createRoomFromApi";
import { postRoom } from "../../../networking/api-requests/rooms.api";
import { useAppDispatch, useAppSelector } from "../../../hooks/hooks";
import { useChatSettingState } from "../../../hooks/useChatSettingState";
import { useToast } from "../../../context/ToastContext";

interface NewChatModalProps {
  handleCloseModal?: any;
}

const NewChatModal: React.FC<NewChatModalProps> = ({ handleCloseModal: handleClose }) => {
 const config = useAppSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const dispatch = useAppDispatch();
  const { client } = useXmppClient();
  const { user } = useChatSettingState();
  const { showToast } = useToast();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'0' | '1' | null>('0');

  const [roomName, setRoomName] = useState<string>('');
  const [roomDescription, setRoomDescription] = useState<string>('');
  const [chatType, setChatType] = useState<ChatAccessOption>({
    name: 'Public',
    id: 'public',
  });
  const [profileImage, setProfileImage] = useState<string | { uri: string; type: string; name: string } | null>(null);
  const [errors, setErrors] = useState({ name: '', description: '' });
  const [selectedUsers, setSelectedUsers] = useState<RoomMember[]>([]);

  const isValid = useMemo(
    // () => roomName.length >= 3 && roomDescription.length >= 5,
    () => roomName.length >= 3,
    [roomName, roomDescription]
  );

  const validateRoomName = (name: string) => {
    if (name.trim().length < 3) {
      return 'Room name must be at least 3 characters.';
    }
    return '';
  };

  // const validateRoomDescription = (description: string) => {
  //   if (description.trim().length < 5) {
  //     return 'Room description must be at least 5 characters.';
  //   }
  //   return '';
  // };

  const handleRoomNameChange = (e: string) => {
    const name = e;
    setRoomName(name);
    setErrors((prevErrors) => ({
      ...prevErrors,
      name: validateRoomName(name),
    }));
  };

  const handleRoomDescriptionChange = (
    e: string
  ) => {
    const description = e;
    setRoomDescription(description);
    setErrors((prevErrors) => ({
      ...prevErrors,
      // description: validateRoomDescription(description),
    }));
  };

  const handleOpenModal = () => setIsModalOpen(true);
  const handleCloseModal = () => {
    handleClose();
    setActiveTab('0');
    setIsModalOpen(false);
    setRoomName('');
    setSelectedUsers([]);
  };

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
    try {
      const permission =
        Platform.OS === "ios"
          ? PERMISSIONS.IOS.PHOTO_LIBRARY
          : PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
      const permissionStatus = await checkPermission(permission);

      if (permissionStatus !== RESULTS.GRANTED) {
        Alert.alert(
          "Permission required",
          "Photo library permission is needed to select images.",
          [
            {
              text: "Cancel",
              onPress: () => console.log("Photo permission cancelled"),
              style: "cancel",
            },
            {
              text: "Open Settings",
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

      const originalName = image.path.split("/").pop();
      const fileObject = {
        uri: image.path,
        type: image.mime || 'image/jpeg',
        name: originalName || `profile_${Date.now()}.jpg`,
      };

      setProfileImage(fileObject);
    } catch (error: any) {
      if (error?.code === 'E_PICKER_CANCELLED' || error?.code === 'E_NO_CAMERA_PERMISSION') {
        console.log('User cancelled image selection');
        return;
      }
      console.error('Image selection failed:', error);
      Alert.alert('Error', 'Failed to select image');
    }
  };

  const onRemoveClick = async () => {
    setProfileImage(null);
  };

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
          room: normalizedChat,
          xmpp: client,
        })
      );

      dispatch(setCurrentRoom({ roomJID: normalizedChat.jid }));

      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: 'Room created successfully',
        type: 'success',
      });
    } catch (error) {
      console.error('Error handling room creation:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to create room',
        type: 'error',
      });
    }
  };

  const handleCreateRoom = async () => {
    setLoading(true);
    if (isValid) {
      let location: string | undefined;
      
      if (profileImage && typeof profileImage === 'object' && 'uri' in profileImage) {
        try {
          const mediaData = new FormData();
          mediaData.append('files', profileImage as any);
          const uploadResult = await uploadFile(mediaData);
          location = uploadResult?.data?.results?.[0]?.location;
        } catch (error) {
          console.error('Failed to upload image:', error);
          setLoading(false);
          return;
        }
      }

      if (config?.newArch) {
        const namesArray = selectedUsers.map((user) => user.xmppUsername);
        const newChat: ApiRoom = await postRoom({
          title: roomName,
          description:
            roomDescription && roomDescription !== ''
              ? roomDescription
              : 'No description',
          picture: location || '',
          type: chatType.id || 'public',
          members: namesArray,
        });

        handleRoomCreation(newChat, namesArray.length);
        handleCloseModal();
      } else {
        try {
          const newChatJid = await client.createRoomStanza(
            roomName,
            roomDescription && roomDescription !== ''
              ? roomDescription
              : 'No description'
          );
  
          client.getRoomsStanza();
  
          dispatch(setCurrentRoom({ roomJID: newChatJid }));
  
          if (location) {
            client.setRoomImageStanza(newChatJid, location, 'icon', 'none');
            dispatch(
              updateRoom({ jid: newChatJid, updates: { icon: location } })
            );
          }

          showToast({
            id: Date.now().toString(),
            title: 'Success',
            message: 'Room created successfully',
            type: 'success',
          });
          handleCloseModal();
        } catch (error) {
          console.error('Failed to create room:', error);
          showToast({
            id: Date.now().toString(),
            title: 'Error',
            message: 'Failed to create room',
            type: 'error',
          });
        }
      }

      setIsModalOpen(false);
      setErrors({ name: '', description: '' });
      setProfileImage(null);
      setRoomName('');
      setRoomDescription('');
      setLoading(false);
    }
  };

  return (
    <>
      {/* <Button
        style={{
          padding: 8,
          borderRadius: 16,
          backgroundColor: "transparent",
        }}
        color="black"
        unstyled
        EndIcon={<AddNewIcon color={config?.colors?.primary} />}
        onPress={handleOpenModal}
      /> */}

      <ModalBackground
      // visible={isModalOpen}
      // transparent={true}
      // animationType="fade"
      // onRequestClose={handleCloseModal}
      >
        <ModalContainer>
          <CloseButton onPress={handleCloseModal}>
            <Text style={{ fontSize: 24, padding: 5 }}>&times;</Text>
          </CloseButton>
          <ModalTitle>Create New Chat</ModalTitle>
          <ProfileImagePlaceholder
            size={120}
            upload={{ active: true, onUpload }}
            remove={{ enabled: true, onRemoveClick }}
            placeholderIcon={<AddPhotoIcon color="#0052CD" />}
            icon={
              profileImage && typeof profileImage === 'object' && 'uri' in profileImage
                ? { uri: profileImage.uri }
                : profileImage
            }
            disableOverlay={!profileImage}
            role="user"
          />
          <GroupContainer
            style={{
              flexDirection: "column",
              position: "relative",
              width: "100%",
            }}
          >
            <InputWithLabel
              color="#F5F7F9"
              id="roomName"
              value={roomName}
              onChangeText={handleRoomNameChange}
              placeholder="Enter Room Name"
              helperText={errors.name}
              error={!!errors.name}
            />
            <InputWithLabel
              color="#F5F7F9"
              id="roomDescription"
              value={roomDescription}
              onChangeText={handleRoomDescriptionChange}
              placeholder="Enter Description"
              helperText={errors.description}
              error={!!errors.description}
            />
          </GroupContainer>

          <GroupContainer>
            <Button
              onPress={handleCreateRoom}
              text={"Create"}
              style={{ width: "100%" }}
              unstyled
              variant="filled"
              disabled={!isValid}
              color="#fff"
            />
            <Button
              onPress={handleCloseModal}
              text={"Cancel"}
              style={{ width: "100%" }}
              unstyled
              variant="outlined"
              color="#0052CD"
            />
          </GroupContainer>
        </ModalContainer>
      </ModalBackground>
    </>
  );
};

export default NewChatModal;
