import React, { FC } from 'react';
import { View } from 'react-native';
import { LastMessage } from '../../../types/types';
import {
  LastRoomMessageContainer,
  LastRoomMessageName,
  LastRoomMessageText,
} from './StyledRoomComponents';
import { LockIcon } from '../../../assets/icons';
import { useTheme } from '../../../hooks/useTheme';
import { useT } from '../../../i18n/useT';

interface LastMessageSealedProps extends Pick<LastMessage, 'user'> {}

const LastMessageSealed: FC<LastMessageSealedProps> = ({ user }) => {
  const t = useT();
  const theme = useTheme();
  const name = user?.name;

  return (
    <LastRoomMessageContainer>
      {!!name && <LastRoomMessageName>{name}:</LastRoomMessageName>}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <LockIcon width={14} height={14} color={theme.textSecondary} />
        <LastRoomMessageText>{t('media.sealedFile')}</LastRoomMessageText>
      </View>
    </LastRoomMessageContainer>
  );
};

export default LastMessageSealed;
