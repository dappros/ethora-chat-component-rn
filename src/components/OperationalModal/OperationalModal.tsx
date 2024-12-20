import React, { useState } from "react";
// import QRCode from 'react-qr-code';
import { CloseButton } from "../Modals/styledModalComponents";
import { Overlay, StyledModal } from "../styled/MediaModal";
import { StyledInput } from "../styled/StyledInputComponents/StyledInputComponents";
import Button from "../styled/Button";
import { Text, View } from "react-native";
import { QRCODE_URL } from "../../helpers/constants/PLATFORM_CONSTANTS";
import Clipboard from "@react-native-clipboard/clipboard";

interface OperationalModalProps {
  isVisible: boolean;
  chatJid: string;
  setVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

const OperationalModal: React.FC<OperationalModalProps> = ({
  isVisible,
  chatJid,
  setVisible,
}) => {
  const handleCopyClick = () => {
    Clipboard.setString(`${QRCODE_URL}${chatJid}`);
  };

  return (
    isVisible && (
      <Overlay
        style={{
          position: "absolute",
        }}
      >
        <StyledModal
          style={{
            borderRadius: 16,
            width: "auto",
            height: "auto",
            paddingHorizontal: 64,
            paddingVertical: 32,
            minWidth: 480,
          }}
        >
          <CloseButton onPress={() => setVisible(false)}>
            <Text style={{ fontSize: 24 }}>&times;</Text>
          </CloseButton>
          <View
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              alignItems: "center",
            }}
          >
            <View style={{ width: "70%", position: "relative" }}></View>

            <View
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                minWidth: 400,
              }}
            >
              <StyledInput
                value={chatJid}
                editable={true}
                style={{ width: "80%" }}
              />
              <Button text="Copy" onPress={handleCopyClick} />
            </View>
          </View>
        </StyledModal>
      </Overlay>
    )
  );
};

export default OperationalModal;
