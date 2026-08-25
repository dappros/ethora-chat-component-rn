import React, { useState } from 'react';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import Button from '../../styled/Button';
import InputWithLabel from '../../styled/StyledInput';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { CenterContainer } from '../styledModalComponents';
import { updateProfile } from '../../../networking/api-requests/user.api';
import { useDispatch } from 'react-redux';
import { updateUser } from '../../../roomStore/chatSettingsSlice';
import { View } from 'react-native';
import { pickImageAsset, PickedImage } from '../../../helpers/pickImageAsset';
import { AddPhotoIcon } from '../../../assets/icons';
// import { actionUpdateUser } from '../actions';

interface EditUserModalProps {
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>;
  modalUser: any;
  config: any;
}

const EditUserModal: React.FC<EditUserModalProps> = ({
  setIsEditing,
  modalUser,
  config,
}) => {
  const dispatch = useDispatch();

  const [firstName, setFirstName] = useState(modalUser?.firstName || '');
  const [lastName, setLastName] = useState(modalUser?.lastName || '');
  const [description, setDescription] = useState(modalUser?.description || '');
  const [profileImage, setProfileImage] = useState<string | PickedImage>(
    modalUser?.profileImage
  );

  const onSave = async () => {
    try {
      let fd = new FormData();

      if (profileImage && typeof profileImage !== 'string') {
        fd.append('file', profileImage as any);
      }

      fd.append('firstName', firstName);
      fd.append('lastName', lastName);
      fd.append('description', description);

      const { user } = await updateProfile(fd);

      dispatch(
        updateUser({
          updates: {
            firstName,
            lastName,
            description,
            profileImage: user?.profileImage,
          },
        })
      );

      setIsEditing(false);
    } catch (error) {
      console.log('error', error);
    }
  };

  const handleProfileImageChange = async () => {
    const picked = await pickImageAsset();
    if (picked) {
      setProfileImage(picked);
    }
  };

  return (
    <>
      <ModalHeaderComponent
        // leftMenu={
        //   <Button
        //     onPress={() => setIsEditing(false)}
        //     style={{
        //       paddingVertical: 13,
        //       paddingHorizontal: 8,
        //       width: "100%",
        //     }}
        //     color="#00"
        //   >
        //     Cancel
        //   </Button>
        // }
        handleCloseModal={() => setIsEditing(false)}
        rightMenu={
          <Button
            onPress={onSave}
            variant="outlined"
            style={{ width: 128 }}
            color="#0052CD"
            text="Save"
          />
        }
      />
      <CenterContainer>
        <ProfileImagePlaceholder
          icon={profileImage}
          name={`${firstName} ${lastName}`}
          size={120}
          upload={{
            onUpload: handleProfileImageChange,
            active: true,
          }}
        />
      </CenterContainer>
      <View
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 32,
          width: '100%',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <InputWithLabel
          color={config?.colors?.primary}
          placeholder="First Name"
          label="First Name"
          value={firstName}
          onChangeText={(text: string) => setFirstName(text)}
        />
        <InputWithLabel
          color={config?.colors?.primary}
          placeholder="Last Name"
          label="Last Name"
          value={lastName}
          onChangeText={(text: string) => setLastName(text)}
        />
        <InputWithLabel
          color={config?.colors?.primary}
          placeholder="About"
          label="About"
          value={description}
          onChangeText={(text: string) => setDescription(text)}
        />
      </View>
    </>
  );
};

export default EditUserModal;
