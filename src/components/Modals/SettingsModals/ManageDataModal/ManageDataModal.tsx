import React, { useState } from 'react';
import {
  LabelData,
  ModalContainerFullScreen,
} from '../../styledModalComponents';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import { useSelector } from 'react-redux';
import { RootState } from '../../../../roomStore';
import styled from 'styled-components/native';
import { InfoIcon } from '../../../../assets/icons';
import {
  deleteMe,
  downloadMyDataExport,
} from '../../../../networking/api-requests/user.api';
import {
  SharedSettingsCenterContainer,
  SharedSettingsColumnContainer,
  SharedSettingsInfoPanel,
  SharedSettingsInfoText,
  SharedSettingsLabelData,
  SharedSettingsSectionContainer,
  SharedSettingsStyledButton,
  SharedSettingsStyledLabel,
  SharedSettingsScrollBody,
} from '../SharedStyledComponents';
import { Alert, Platform, Share, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useTheme } from '../../../../hooks/useTheme';
import { useT } from '../../../../i18n/useT';
import { useLogout } from '../../../../hooks/useLogout';
import { useToast } from '../../../../context/ToastContext';

interface ManageDataModalProps {
  handleCloseModal: any;
}

const InfoPanel = styled.View`
  background-color: "#F3F6FC";
  display: flex;
  gap: 8px;
  border-radius: 8px;
  padding: 8px;
`;

const ManageDataModal: React.FC<ManageDataModalProps> = ({
  handleCloseModal,
}) => {
  const { config } = useSelector((state: RootState) => state.chatSettingStore);
  const theme = useTheme();
  const t = useT();

  const performLogout = useLogout();
  const { showToast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const showError = (message: string) =>
    showToast({
      id: Date.now().toString(),
      title: t('toast.error'),
      message,
      type: 'error',
    });

  const handleDownloadClick = async () => {
    if (isDownloading) {return;}
    setIsDownloading(true);
    try {
      const fileName = 'my-data.json';
      const download = await downloadMyDataExport(
        `${FileSystem.cacheDirectory}${fileName}`
      );

      if (Platform.OS === 'android') {
        // Android has no shareable file URL; let the user pick a folder
        // through the Storage Access Framework and write the copy there.
        const saf = (FileSystem as any).StorageAccessFramework;
        const perm = await saf.requestDirectoryPermissionsAsync();
        if (!perm.granted) {return;}
        const base64 = await FileSystem.readAsStringAsync(download.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const destUri = await saf.createFileAsync(
          perm.directoryUri,
          fileName.replace(/\.[^/.]+$/, ''),
          download.mimeType || 'application/json'
        );
        await FileSystem.writeAsStringAsync(destUri, base64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        showToast({
          id: Date.now().toString(),
          title: t('toast.successTitle'),
          message: t('toast.saveSuccessful'),
          type: 'success',
        });
        return;
      }

      // iOS: the share sheet offers "Save to Files", AirDrop, etc. and is
      // itself the confirmation, so no success toast.
      await Share.share({ url: download.uri, title: fileName });
    } catch (err) {
      console.error('ManageDataModal: data export failed', err);
      showError(t('settings.manageData.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  const deleteAccount = async () => {
    setIsDeleting(true);
    try {
      await deleteMe();
    } catch (err) {
      console.error('ManageDataModal: account deletion failed', err);
      showError(t('settings.manageData.deleteFailed'));
      setIsDeleting(false);
      return;
    }
    // The account is gone server-side: tear the local session down the
    // same way a logout does, then let the host navigate away.
    await performLogout();
    try {
      await config?.logout?.onAfterLogout?.();
    } catch (e) {
      console.warn('ManageDataModal: onAfterLogout threw', e);
    }
  };

  const handleDeleteClick = () => {
    if (isDeleting) {return;}
    Alert.alert(
      t('settings.manageData.deleteConfirmTitle'),
      t('settings.manageData.deleteConfirmMessage'),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('action.delete'),
          style: 'destructive',
          onPress: () => {
            deleteAccount();
          },
        },
      ]
    );
  };

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.manageData.title')}
      />
      <SharedSettingsScrollBody>
        <SharedSettingsCenterContainer>
          <SharedSettingsColumnContainer>
            <SharedSettingsSectionContainer>
              <SharedSettingsStyledLabel>
                {t('settings.manageData.downloadLabel')}
              </SharedSettingsStyledLabel>
              <LabelData
                style={{
                  fontSize: 12,
                  textAlign: 'left',
                }}
              >
                {t('settings.manageData.downloadDescription')}
              </LabelData>
            </SharedSettingsSectionContainer>
            <SharedSettingsStyledButton
              borderColor={theme.primary}
              onPress={handleDownloadClick}
              loading={isDownloading}
              text={t('settings.manageData.downloadLabel')}
              color={theme.primary}
            />
          </SharedSettingsColumnContainer>
          <SharedSettingsColumnContainer>
            <SharedSettingsSectionContainer>
              <SharedSettingsStyledLabel>
                {t('settings.manageData.deleteLabel')}
              </SharedSettingsStyledLabel>
              <SharedSettingsLabelData>
                {t('settings.manageData.deleteDescription')}
              </SharedSettingsLabelData>
            </SharedSettingsSectionContainer>
            <SharedSettingsInfoPanel
              bgColor={theme.surfaceHighlight}
            >
              <View>
                <InfoIcon color={theme.primary} />
              </View>
              <SharedSettingsInfoText>
                {t('settings.manageData.deleteDisclosure')}
              </SharedSettingsInfoText>
            </SharedSettingsInfoPanel>
            <SharedSettingsStyledButton
              borderColor={theme.danger}
              onPress={handleDeleteClick}
              loading={isDeleting}
              text={t('action.deleteMyAccount')}
              color={theme.danger}
            />
          </SharedSettingsColumnContainer>
        </SharedSettingsCenterContainer>
      </SharedSettingsScrollBody>
    </ModalContainerFullScreen>
  );
};

export default ManageDataModal;
