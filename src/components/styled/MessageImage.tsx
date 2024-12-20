import React from "react";
import { Container } from "./StyledInputComponents/MediaComponents";
import { useDispatch } from "react-redux";
import {
  setActiveFile,
  setActiveModal,
} from "../../roomStore/chatSettingsSlice";
import { MODAL_TYPES } from "../../helpers/constants/MODAL_TYPES";
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
  const dispatch = useDispatch();

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <Container>
      {fileURL ? (
        <img
          src={fileURL}
          alt={fileName}
          onClick={handleOpen}
          style={{
            borderRadius: 16,
            cursor: "pointer",
            maxWidth: 150,
            maxHeight: 200,
          }}
          onError={(e) => {
            (e.target as HTMLImageElement).src =
              "https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg";
          }}
        />
      ) : (
        <img
          src="https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg"
          alt={fileName}
          onClick={handleOpen}
          style={{
            borderRadius: 16,
            cursor: "pointer",
            maxWidth: 150,
            maxHeight: 200,
          }}
        />
      )}
    </Container>
  );
};

export default CustomMessageImage;
