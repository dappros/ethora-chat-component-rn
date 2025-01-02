import React, { FC } from "react";
import { EditIcon } from "../../assets/icons";
import { styled } from "styled-components/native";
import { Text, TouchableOpacity, View } from "react-native";

export const EditContainer = styled.View`
  background-color: #0052cd0d;
  padding: 12px 24px;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
`;

export const EditInfoBox = styled.View`
  flex-direction: row;
  align-items: center;
`;

export const EditTitle = styled.Text`
  margin: 0px;
  color: rgb(140, 140, 140);
  text-align: start;
  font-size: 12px;
  padding-bottom: 4px;
`;

export const EditText = styled.Text`
  margin: 0px;
  font-size: 16px;
  text-align: start;
`;

interface EditWrapperProps {
  text: string;
  onClose: () => void;
}

export const EditWrapper: FC<EditWrapperProps> = ({ text, onClose }) => {
  console.log("text", text);
  return (
    <EditContainer>
      <EditInfoBox>
        <View
          style={{
            padding: 9,
            paddingRight: 20,
            paddingLeft: 0,
            borderRightWidth: 1,
            borderRightColor: "#0052CD",
            borderStyle: "solid",
          }}
        >
          <EditIcon color="#0052CD" />
        </View>
        <View style={{ paddingLeft: 20 }}>
          <EditTitle>Edit Message</EditTitle>
          <EditText>{text}</EditText>
        </View>
      </EditInfoBox>
      <TouchableOpacity
        style={{
          // background: "none",
          // border: "none",
          borderRadius: 8,
        }}
        onPress={onClose}
      >
        <Text style={{ fontSize: 24, color: "#888" }}>&times;</Text>
      </TouchableOpacity>
    </EditContainer>
  );
};
