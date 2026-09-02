import React, { useState, useMemo } from 'react';
import { CameraIcon } from '../../../assets/icons';
import { RootState } from '../../../roomStore';
import { useXmppClient } from '../../../context/xmppProvider';
import { addRoomViaApi, setCurrentRoom, updateRoom } from '../../../roomStore/roomsSlice';
import { uploadFile } from '../../../networking/api-requests/auth.api';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getIconColor } from '../../../helpers/getIconColor';
import { useT } from '../../../i18n/useT';
import * as ImagePicker from 'expo-image-picker';
import { ApiRoom, ChatAccessOption, RoomMember } from '../../../types/models/room.model';
import { createRoomFromApi } from '../../../helpers/createRoomFromApi';
import { postRoom } from '../../../networking/api-requests/rooms.api';
import { useAppDispatch, useAppSelector } from '../../../hooks/hooks';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { useToast } from '../../../context/ToastContext';

interface NewChatModalProps {
  handleCloseModal?: () => void;
}

const NewChatModal: React.FC<NewChatModalProps> = ({
  // Some call sites mount `<NewChatModal />` with no props (e.g. the
  // empty-state in ChatRoom when roomsList is empty). There is nothing to
  // dismiss back to there, so Cancel just resets the form.
  handleCloseModal: handleClose,
}) => {
  const t = useT();
 const config = useAppSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const dispatch = useAppDispatch();
  const { client } = useXmppClient();
  const { user } = useChatSettingState();
  const { showToast } = useToast();

  const [loading, setLoading] = useState<boolean>(false);

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
      return t('modal.newChat.nameTooShort');
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

  const resetForm = () => {
    setRoomName('');
    setRoomDescription('');
    setProfileImage(null);
    setSelectedUsers([]);
    setErrors({ name: '', description: '' });
  };

  const handleCloseModal = () => {
    resetForm();
    handleClose?.();
  };

  const onUpload = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== 'granted') {
        Alert.alert(
          'Permission required',
          'Photo library permission is needed to select images.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
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

      if (result.canceled) {return;}

      const asset = result.assets[0];
      const originalName = asset.uri.split('/').pop();
      const fileObject = {
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
        name: originalName || `profile_${Date.now()}.jpg`,
      };

      setProfileImage(fileObject);
    } catch (error: any) {
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

      if (!normalizedChat || !client) {return;}

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
          const newChatJid = await client?.createRoomStanza(
            roomName,
            roomDescription && roomDescription !== ''
              ? roomDescription
              : 'No description'
          );

          const jidStr = typeof newChatJid === 'string' ? newChatJid : '';
          client?.getRoomsStanza();

          dispatch(setCurrentRoom({ roomJID: jidStr }));

          if (location) {
            client?.setRoomImageStanza(jidStr, location, 'icon', 'none');
            dispatch(
              updateRoom({ jid: jidStr, updates: { icon: location } })
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

      resetForm();
      setLoading(false);
    }
  };

  const primary = getIconColor(config);
  const pickedUri =
    profileImage && typeof profileImage === 'object' && 'uri' in profileImage
      ? profileImage.uri
      : typeof profileImage === 'string'
        ? profileImage
        : null;

  return (
    // A real <Modal> rather than an in-tree overlay: the SDK renders inside
    // whatever frame the host gives it, so an in-tree backdrop stopped at
    // the component's edge and left the host's own chrome (tab bars and
    // such) lit. This one dims the whole window.
    <Modal
      transparent
      visible
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCloseModal}
    >
      <View style={styles.backdrop}>
        <Pressable
          testID="new-chat-backdrop"
          style={StyleSheet.absoluteFill}
          onPress={handleCloseModal}
        />
        <View style={styles.card}>
          <Text style={styles.title}>{t('modal.newChat.title')}</Text>

          <TouchableOpacity
            testID="new-chat-picture"
            activeOpacity={0.8}
            onPress={onUpload}
            onLongPress={pickedUri ? onRemoveClick : undefined}
            style={[styles.picture, { backgroundColor: primary }]}
          >
            {pickedUri ? (
              <Image source={{ uri: pickedUri }} style={styles.pictureImage} />
            ) : (
              <CameraIcon color="#FFFFFF" width={26} height={26} />
            )}
          </TouchableOpacity>

          <TextInput
            testID="new-chat-name"
            style={styles.input}
            value={roomName}
            onChangeText={handleRoomNameChange}
            placeholder={t('modal.newChat.roomNamePlaceholder')}
            placeholderTextColor="#8C8C8C"
            returnKeyType="next"
          />
          {!!errors.name && roomName.length > 0 && (
            <Text testID="new-chat-name-error" style={styles.error}>
              {errors.name}
            </Text>
          )}

          <TextInput
            testID="new-chat-description"
            style={[styles.input, styles.textArea]}
            value={roomDescription}
            onChangeText={handleRoomDescriptionChange}
            placeholder={t('modal.newChat.descriptionPlaceholder')}
            placeholderTextColor="#8C8C8C"
            multiline
          />

          <View style={styles.buttons}>
            <TouchableOpacity
              testID="new-chat-cancel"
              activeOpacity={0.7}
              style={[styles.button, styles.cancel]}
              onPress={handleCloseModal}
            >
              <Text style={styles.cancelLabel}>{t('action.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="new-chat-submit"
              activeOpacity={0.7}
              disabled={!isValid || loading}
              style={[
                styles.button,
                { backgroundColor: primary, opacity: !isValid || loading ? 0.5 : 1 },
              ]}
              onPress={handleCreateRoom}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.submitLabel}>
                  {t('modal.newChat.createButton')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Opaque, per the design: the chat list behind stays hidden rather
    // than showing through a translucent dim.
    backgroundColor: '#E9EDF2',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 20,
    shadowColor: '#121219',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 6,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#141414',
    textAlign: 'center',
  },
  picture: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    marginVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pictureImage: {
    width: '100%',
    height: '100%',
  },
  input: {
    borderRadius: 12,
    backgroundColor: '#F4F5F7',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#141414',
    marginTop: 10,
  },
  textArea: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  error: {
    color: '#E53935',
    fontSize: 12,
    marginTop: 6,
    marginLeft: 4,
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: {
    backgroundColor: '#E7E8EA',
  },
  cancelLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8C8C8C',
  },
  submitLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});

export default NewChatModal;
