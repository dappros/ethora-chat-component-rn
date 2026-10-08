import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import { ModalContainerFullScreen } from '../../styledModalComponents';
import { useTheme } from '../../../../hooks/useTheme';
import type { ChatTheme } from '../../../../theme/theme';
import { useT } from '../../../../i18n/useT';
import { useToast } from '../../../../context/ToastContext';
import { useChatSettingState } from '../../../../hooks/useChatSettingState';
import { changePassword } from '../../../../networking/api-requests/user.api';
import { chatTextStyle } from '../../../../helpers/typography';

/** What the backend asks of a password at sign-up. */
export const MIN_PASSWORD_LENGTH = 8;

/** The reason a backend gave, or nothing - never an axios dump. */
const serverReason = (error: any): string => {
  const data = error?.response?.data;
  const text =
    (typeof data === 'string' && data) ||
    data?.message ||
    data?.error ||
    (Array.isArray(data?.errors) && data.errors.map((e: any) => e?.message || e).join(', ')) ||
    '';
  return typeof text === 'string' ? text.trim() : '';
};

interface FieldProps {
  testID: string;
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  error?: string;
  editable: boolean;
  newPassword?: boolean;
  onSubmitEditing?: () => void;
  styles: ReturnType<typeof createStyles>;
  theme: ChatTheme;
}

/** One labelled password field: label above, error (if any) below. */
const Field: React.FC<FieldProps> = ({
  testID,
  label,
  value,
  onChangeText,
  error,
  editable,
  newPassword,
  onSubmitEditing,
  styles,
  theme,
}) => (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      testID={testID}
      style={[styles.input, error ? styles.inputError : null]}
      value={value}
      onChangeText={onChangeText}
      placeholder={label}
      placeholderTextColor={theme.textMuted}
      keyboardAppearance={theme.dark ? 'dark' : 'light'}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      textContentType={newPassword ? 'newPassword' : 'password'}
      editable={editable}
      returnKeyType={onSubmitEditing ? 'done' : 'next'}
      onSubmitEditing={onSubmitEditing}
      blurOnSubmit={!!onSubmitEditing}
    />
    {error ? <Text style={styles.fieldError}>{error}</Text> : null}
  </View>
);

interface ChangePasswordModalProps {
  handleCloseModal: () => void;
}

/**
 * Change the account password: the current one, the new one twice. Nothing
 * is sent until the form is complete and the two match; what the backend
 * refuses is shown as it said it. Laid out like the Settings screen it is
 * reached from: one card on the list ground.
 */
const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ handleCloseModal }) => {
  const theme = useTheme();
  const t = useT();
  const { showToast } = useToast();
  const { config } = useChatSettingState();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const mismatch = again.length > 0 && next !== again;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const sameAsCurrent = next.length > 0 && next === current;
  const ready =
    current.length > 0 &&
    next.length >= MIN_PASSWORD_LENGTH &&
    next === again &&
    !sameAsCurrent &&
    !busy;

  const submit = useCallback(async () => {
    if (!ready) {return;}
    setBusy(true);
    setError('');
    try {
      await changePassword(current, next);
      showToast({
        id: Date.now().toString(),
        title: t('settings.password.title'),
        message: t('settings.password.changed'),
        type: 'success',
      });
      handleCloseModal();
    } catch (err) {
      const status = (err as any)?.response?.status;
      setError(
        serverReason(err) ||
          (status === 400 || status === 401 || status === 403
            ? t('settings.password.wrongCurrent')
            : t('settings.password.failed'))
      );
      setBusy(false);
    }
  }, [current, handleCloseModal, next, ready, showToast, t]);

  const newError = tooShort
    ? t('settings.password.tooShort', { min: MIN_PASSWORD_LENGTH })
    : sameAsCurrent
      ? t('settings.password.sameAsCurrent')
      : undefined;

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.password.title')}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.fill}
      >
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card} testID="settings-change-password">
            <Field
              testID="password-current"
              label={t('settings.password.current')}
              value={current}
              onChangeText={setCurrent}
              editable={!busy}
              styles={styles}
              theme={theme}
            />
            <Field
              testID="password-new"
              label={t('settings.password.new')}
              value={next}
              onChangeText={setNext}
              error={newError}
              editable={!busy}
              newPassword
              styles={styles}
              theme={theme}
            />
            <Field
              testID="password-again"
              label={t('settings.password.again')}
              value={again}
              onChangeText={setAgain}
              error={mismatch ? t('settings.password.mismatch') : undefined}
              editable={!busy}
              newPassword
              onSubmitEditing={submit}
              styles={styles}
              theme={theme}
            />
            <Text style={styles.hint}>{t('settings.password.hint')}</Text>
          </View>

          {!!error && (
            <Text testID="password-error" style={styles.error}>
              {error}
            </Text>
          )}

          <TouchableOpacity
            testID="password-submit"
            accessibilityRole="button"
            accessibilityState={{ disabled: !ready }}
            activeOpacity={0.8}
            disabled={!ready}
            onPress={submit}
            style={[styles.button, !ready ? styles.buttonDisabled : null]}
          >
            {busy ? (
              <ActivityIndicator color={theme.textOnPrimary} />
            ) : (
              <Text style={[styles.buttonText, !ready ? styles.buttonTextDisabled : null]}>
                {t('settings.password.submit')}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </ModalContainerFullScreen>
  );
};

export default ChangePasswordModal;

const createStyles = (theme: ChatTheme) =>
  StyleSheet.create({
    screen: {
      backgroundColor: theme.listBackground,
    },
    fill: {
      flex: 1,
      width: '100%',
    },
    body: {
      padding: 12,
      gap: 12,
      paddingBottom: 32,
    },
    // Same surface as the Settings cards this screen is reached from.
    card: {
      backgroundColor: theme.surface,
      borderRadius: 20,
      paddingHorizontal: 20,
      paddingVertical: 22,
      gap: 18,
      shadowColor: theme.shadow,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 3,
    },
    field: {
      gap: 8,
    },
    fieldLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    input: {
      height: 48,
      paddingHorizontal: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
      fontSize: 16,
      color: theme.text,
    },
    inputError: {
      borderColor: theme.danger,
    },
    fieldError: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.danger,
    },
    hint: {
      fontSize: 13,
      lineHeight: 18,
      color: theme.textSecondary,
    },
    error: {
      fontSize: 14,
      lineHeight: 19,
      paddingHorizontal: 8,
      color: theme.danger,
    },
    button: {
      minHeight: 48,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      backgroundColor: theme.primary,
    },
    buttonDisabled: {
      backgroundColor: theme.surfaceSecondary,
    },
    buttonText: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.textOnPrimary,
    },
    buttonTextDisabled: {
      color: theme.textMuted,
    },
  });
