import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LockIcon } from '../../assets/icons';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';

const EncryptedSendNotice: React.FC = () => {
  const theme = useTheme();
  const t = useT();
  return (
    <View style={styles.notice} testID="e2ee-send-notice">
      <LockIcon width={18} height={18} color={theme.textSecondary} />
      <Text style={[styles.text, { color: theme.textSecondary }]}>
        {t('e2ee.sendUnavailable')}
      </Text>
    </View>
  );
};

export default EncryptedSendNotice;

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
  },
});
