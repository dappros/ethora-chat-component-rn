import React, { FC } from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { useDispatch } from 'react-redux';
import { SearchIcon } from '../../assets/icons';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { getIconColor } from '../../helpers/getIconColor';
import { useT } from '../../i18n/useT';
import { setActiveModal } from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import type { IConfig } from '../../types/types';

/**
 * Message search needs the app id (the archive it queries is scoped by app)
 * and can be switched off by the host.
 */
export const isMessageSearchEnabled = (config?: IConfig): boolean =>
  Boolean(config?.appId) && !config?.disableMessageSearch;

/** Magnifier in the chat header that opens the message search screen. */
export const MessageSearchButton: FC = () => {
  const { config } = useChatSettingState();
  const t = useT();
  const dispatch = useDispatch();

  if (!isMessageSearchEnabled(config)) {
    return null;
  }

  return (
    <TouchableOpacity
      testID="chat-header-search-messages"
      accessibilityRole="button"
      accessibilityLabel={t('search.messages.title')}
      onPress={() => dispatch(setActiveModal(MODAL_TYPES.MESSAGE_SEARCH))}
      style={styles.button}
      hitSlop={8}
    >
      <SearchIcon color={getIconColor(config)} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MessageSearchButton;
