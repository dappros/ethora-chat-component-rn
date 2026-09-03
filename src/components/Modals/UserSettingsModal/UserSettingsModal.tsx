/** @format */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useDispatch } from 'react-redux';
import { ModalContainerFullScreen } from '../styledModalComponents';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { ArowDownIcon } from '../../../assets/icons';
import { setActiveModal } from '../../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
import { useT } from '../../../i18n/useT';

interface UserSettingsModalProps {
  handleCloseModal: any;
}

const UserSettingsModal: React.FC<UserSettingsModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const dispatch = useDispatch();
  const { config } = useChatSettingState();

  const options = useMemo(
    () => [
      { label: t('settings.manageData.title'), key: MODAL_TYPES.MANAGE_DATA },
      { label: t('settings.visibility.title'), key: MODAL_TYPES.VISIBILITY },
    ],
    [t]
  );

  const handleClick = useCallback(
    (key: string) => {
      dispatch(setActiveModal(key as any));
    },
    [dispatch]
  );

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.menu.title')}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
      />
      {/* One card per entry, rather than a single bordered block with
        * hairline dividers — the rows are separate destinations, and the
        * design gives each its own surface. */}
      <View style={styles.body}>
        {options.map((option) => (
          <TouchableOpacity
            key={option.key}
            testID={`settings-row-${option.key}`}
            activeOpacity={0.7}
            style={styles.card}
            onPress={() => handleClick(option.key)}
          >
            <Text style={styles.label}>{option.label}</Text>
            <ArowDownIcon color="#8C8C8C" width={20} height={20} style={styles.chevron} />
          </TouchableOpacity>
        ))}
      </View>
    </ModalContainerFullScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#E8EDF2',
  },
  body: {
    width: '100%',
    padding: 12,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 22,
    shadowColor: '#101828',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
  },
  label: {
    fontSize: 17,
    fontWeight: '500',
    color: '#141414',
  },
  chevron: {
    transform: [{ rotate: '-90deg' }],
  },
});

export default UserSettingsModal;
