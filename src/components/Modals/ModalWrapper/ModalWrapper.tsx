import { FC, useRef, useState } from 'react';
import {
  CloseButton,
  GroupContainer,
  ModalBackground,
  ModalContainer,
  ModalDescription,
  ModalTitle,
} from '../styledModalComponents';
import { TextareaInput } from '../../styled/StyledInputComponents/StyledInputComponents';
import Button from '../../styled/Button';
import { Modal, Text, TextInput, View, StyleSheet } from 'react-native';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { getIconColor } from '../../../helpers/getIconColor';

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
  /**
   * When true, render a small centered dialog instead of the default
   * full-screen container. Used for confirm-style modals (Delete, Leave
   * room) where edge-to-edge feels too heavy.
   */
  compact?: boolean;
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
  compact = false,
}) => {
  const textareaRef = useRef<TextInput>(null);
  const { config } = useChatSettingState();

  // const handleInput = () => {
  //   const textarea = textareaRef.current;
  //   if (textarea) {
  //     textarea.style.height = "auto";
  //     textarea.style.height = `${textarea.scrollHeight}px`;
  //   }
  // };

  const inner = (
    <>
      <CloseButton onPress={handleCloseModal}>
        <Text style={{ fontSize: 24 }}>&times;</Text>
      </CloseButton>
      {IconTitle ? <IconTitle /> : <ModalTitle>{title}</ModalTitle>}
      {description && <ModalDescription>{description}</ModalDescription>}
      {isTextarea && (
        <GroupContainer
          style={{ flexDirection: 'column', position: 'relative' }}
        />
      )}
      {!buttonText && <GroupContainer />}
      <GroupContainer>
        <Button
          onPress={handleCloseModal}
          text={'Cancel'}
          style={{ width: '100%' }}
          unstyled
          variant="outlined"
          // Outlined Button draws its border from `backgroundColor`
          // (defaults to the hardcoded blue) — feed it the themed color.
          borderColor={getIconColor(config)}
        />
        {buttonText && (
          <Button
            testID="modal-confirm-button"
            accessibilityLabel="modal-confirm-button"
            onPress={handleClick}
            text={buttonText}
            // White label on the filled (e.g. red Delete) button. Button
            // applies an inline `color: color || 'black'` that overrides
            // the filled-variant white, so pass it explicitly.
            color="#FFFFFF"
            style={{
              width: '100%',
              backgroundColor: backgroundColorButton,
            }}
            unstyled
            variant="filled"
          />
        )}
      </GroupContainer>
    </>
  );

  return (
    <Modal
      transparent
      animationType="fade"
      visible={true}
      onRequestClose={handleCloseModal}
    >
      <ModalBackground>
        {compact ? (
          // Dedicated small centered dialog. The base ModalContainer is
          // flex:1 / width:100% / height:100% (full-screen); style-merge
          // overrides proved unreliable, so confirm-style modals render in
          // their own bounded View instead — never full-screen (#14).
          // (Upstream also shrank this modal; this keeps that intent while
          // adding the white filled-button label via `inner` below.)
          <View style={styles.compactDialog}>{inner}</View>
        ) : (
          <ModalContainer style={{ maxWidth: 640 }}>{inner}</ModalContainer>
        )}
      </ModalBackground>
    </Modal>
  );
};

const styles = StyleSheet.create({
  compactDialog: {
    width: '85%',
    maxWidth: 360,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
});
