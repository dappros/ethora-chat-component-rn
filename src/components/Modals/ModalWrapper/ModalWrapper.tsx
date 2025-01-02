import { FC, useRef, useState } from "react";
import {
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalDescription,
  ModalTitle,
} from "../styledModalComponents";
import { TextareaInput } from "../../styled/StyledInputComponents/StyledInputComponents";
import Button from "../../styled/Button";
import { Modal, Text, TextInput } from "react-native";

interface ModalWrapperProps {
  iconTitle?: any;
  title: string;
  description?: string;
  buttonText?: string;
  backgroundColorButton?: string;
  isTextarea?: boolean;
  textarea?: string;
  setTextarea?: (value: string) => void;
  handleCloseModal: () => void;
  handleClick: () => void;
}

export const ModalWrapper: FC<ModalWrapperProps> = ({
  iconTitle: IconTitle,
  title,
  description,
  buttonText,
  backgroundColorButton,
  isTextarea,
  textarea,
  setTextarea,
  handleCloseModal,
  handleClick,
}) => {
  const textareaRef = useRef<TextInput>(null);

  // const handleInput = () => {
  //   const textarea = textareaRef.current;
  //   if (textarea) {
  //     textarea.style.height = "auto";
  //     textarea.style.height = `${textarea.scrollHeight}px`;
  //   }
  // };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={handleCloseModal}
    >
      <ModalBackground>
        <ModalContainer style={{ maxWidth: 640 }}>
          <CloseButton onPress={handleCloseModal}>
            <Text style={{ fontSize: 24 }}>&times;</Text>
          </CloseButton>
          {IconTitle ? <IconTitle /> : <ModalTitle>{title}</ModalTitle>}
          {description && <ModalDescription>{description}</ModalDescription>}
          {isTextarea && (
            <GroupContainer
              style={{ flexDirection: "column", position: "relative" }}
            >
              {/* <TextareaInput
              ref={textareaRef}
              onInput={handleInput}
              id="additionalDetails"
              value={textarea}
              onChangeText={(text) => setTextarea(text)}
              placeholder="Additional Details"
            /> */}
            </GroupContainer>
          )}
          {!buttonText && <GroupContainer></GroupContainer>}
          <GroupContainer>
            <Button
              onPress={handleCloseModal}
              text={"Cancel"}
              style={{ width: "100%" }}
              unstyled
              variant="outlined"
            />
            {buttonText && (
              <Button
                onPress={handleClick}
                text={buttonText}
                style={{
                  width: "100%",
                  backgroundColor: backgroundColorButton,
                }}
                unstyled
                variant="filled"
              />
            )}
          </GroupContainer>
        </ModalContainer>
      </ModalBackground>
    </Modal>
  );
};
