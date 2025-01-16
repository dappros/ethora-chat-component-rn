import React, { useState } from "react";
import { Container } from "./StyledInputComponents/MediaComponents";
import { useDispatch } from "react-redux";
import {
  setActiveFile,
  setActiveModal,
} from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
import { ActivityIndicator, Image, TouchableOpacity } from "react-native";
interface CustomMessageImageProps {
  fileURL: string;
  fileName: string;
  mimetype: string;
}

const CustomMessageImage: React.FC<CustomMessageImageProps> = ({
  fileURL,
  fileName,
  mimetype,
}) => {
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const dispatch = useDispatch();

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <Container>
      <TouchableOpacity onPress={handleOpen}>
        {loading && <ActivityIndicator size="small" color="#0052CD" />}
        <Image
          src={
            fileURL ||
            "https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg"
          }
          style={{
            borderRadius: 16,
            width: 150,
            height: 200,
          }}
          onError={() => setError(true)}
          onLoadEnd={() => setLoading(false)}
          resizeMode="cover"
        />
      </TouchableOpacity>
    </Container>
  );
};

export default CustomMessageImage;
