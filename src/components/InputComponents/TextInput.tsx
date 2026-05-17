import React, { useCallback } from 'react';
import { SendIcon } from '../../assets/icons';
import { IConfig } from '../../types/types';
import Button from '../styled/Button';
import { MessageInput } from '../styled/StyledInputComponents/StyledInputComponents';

interface TextInputProps {
  message: string;
  setMessage: (value: string) => void;
  handleSendClick: () => void;
  isLoading: boolean;
  config?: IConfig;
  onFocus?: () => void;
  onBlur?: () => void;
}

const TextInput: React.FC<TextInputProps> = ({
  message,
  setMessage,
  handleSendClick,
  config,
  isLoading,
  onFocus,
  onBlur,
}) => {
  const handleInputChange = useCallback(
    (text: string) => {
      setMessage(text);
    },
    [setMessage]
  );

  const handleKeyDown = useCallback(
    (event: { nativeEvent: { key: string } }) => {
      if (event.nativeEvent.key === 'Enter' && message) {
        handleSendClick();
      }
    },
    [handleSendClick, message]
  );

  return (
    <>
      <MessageInput
        // Stable testIDs so Maestro / Detox / Appium can drive the
        // chat-send flow reliably. accessibilityLabel mirrors the
        // testID so iOS accessibility-id lookups also work.
        testID="chat-message-input"
        accessibilityLabel="chat-message-input"
        color={config?.colors?.primary}
        placeholder="Type message"
        value={message}
        onChangeText={handleInputChange}
        onSubmitEditing={handleSendClick}
        onFocus={onFocus}
        onBlur={onBlur}
        editable={!isLoading}
      />
      <Button
        testID="chat-send-button"
        accessibilityLabel="chat-send-button"
        onPress={handleSendClick}
        EndIcon={<SendIcon color={!message ? '#D4D4D8' : '#fff'} />}
        style={{
          borderRadius: 100,
          backgroundColor: !message ? 'transparent' : config?.colors?.primary,
        }}
      />
    </>
  );
};

export default TextInput;
