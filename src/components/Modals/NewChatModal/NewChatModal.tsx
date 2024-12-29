import React, { useState, useEffect, useMemo } from "react";
import Button from "../../styled/Button";
import { AddNewIcon, AddPhotoIcon } from "../../../assets/icons";
import { useDispatch, useSelector } from "react-redux";
import { RootState } from "../../../roomStore";
import { useXmppClient } from "../../../context/xmppProvider";
import {
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalTitle,
} from "../styledModalComponents";
import { setCurrentRoom, updateRoom } from "../../../roomStore/roomsSlice";
import InputWithLabel from "../../styled/StyledInput";
import { uploadFile } from "../../../networking/api-requests/auth.api";
import { ProfileImagePlaceholder } from "../../MainComponents/ProfileImagePlaceholder";
import { Text } from "react-native";

interface NewChatModalProps {
  handleCloseModal: any;
}

const NewChatModal: React.FC<NewChatModalProps> = ({ handleCloseModal }) => {
  const config = useSelector(
    (state: RootState) => state.chatSettingStore.config
  );

  const dispatch = useDispatch();
  const { client } = useXmppClient();

  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [roomName, setRoomName] = useState<string>("");
  const [roomDescription, setRoomDescription] = useState<string>("");
  const [profileImage, setProfileImage] = useState<string | File | null>(null);
  const [errors, setErrors] = useState({ name: "", description: "" });

  const isValid = useMemo(
    () => roomName.length >= 3 && roomDescription.length >= 5,
    [roomName, roomDescription]
  );

  const validateRoomName = (name: string) => {
    if (name.trim().length < 3) {
      return "Room name must be at least 3 characters.";
    }
    return "";
  };

  const validateRoomDescription = (description: string) => {
    if (description.trim().length < 5) {
      return "Room description must be at least 5 characters.";
    }
    return "";
  };

  const handleRoomNameChange = (text: string) => {
    console.log("adsasd");
    const name = text;
    setRoomName(name);
    setErrors((prevErrors) => ({
      ...prevErrors,
      name: validateRoomName(name),
    }));
  };

  const handleRoomDescriptionChange = (text: string) => {
    const description = text;
    setRoomDescription(description);
    setErrors((prevErrors) => ({
      ...prevErrors,
      description: validateRoomDescription(description),
    }));
  };

  const handleOpenModal = () => setIsModalOpen(true);
  // const handleCloseModal = () =>{
  //    setIsModalOpen(false)
  // };

  const onUpload = async (file: File) => {
    setProfileImage(file);
  };

  const onRemoveClick = async () => {
    setProfileImage(null);
  };

  const handleCreateRoom = async () => {
    if (isValid) {
      console.log("11111111111", roomName);
      let mediaData: FormData | null = new FormData();
      mediaData.append("files", profileImage);

      const uploadResult = await uploadFile(mediaData);

      const location = uploadResult?.data?.results?.[0]?.location;
      if (!location) {
        throw new Error("No location found in upload result.");
      }

      const newChatJid = await client.createRoomStanza(
        roomName,
        roomDescription
      );

      client.setRoomImageStanza(newChatJid, location, "icon", "none");
      client.getRoomsStanza();
      dispatch(setCurrentRoom({ roomJID: newChatJid }));
      dispatch(updateRoom({ jid: newChatJid, updates: { icon: location } }));
      setIsModalOpen(false);
      setErrors({ name: "", description: "" });
      setRoomName("");
      setRoomDescription("");
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
            icon={profileImage}
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
