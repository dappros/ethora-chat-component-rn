import React from 'react';
import {
  LabelData,
  ModalContainerFullScreen,
} from '../../styledModalComponents';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import { useSelector } from 'react-redux';
import { RootState } from '../../../../roomStore';
import styled from 'styled-components/native';
import { InfoIcon } from '../../../../assets/icons';
import { getExportMyData } from '../../../../networking/api-requests/user.api';
import {
  SharedSettingsCenterContainer,
  SharedSettingsColumnContainer,
  SharedSettingsInfoPanel,
  SharedSettingsInfoText,
  SharedSettingsLabelData,
  SharedSettingsSectionContainer,
  SharedSettingsStyledButton,
  SharedSettingsStyledLabel,
} from '../SharedStyledComponents';
import { View } from 'react-native';
import { useTheme } from '../../../../hooks/useTheme';
import { useT } from '../../../../i18n/useT';

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

  const handleDownloadClick = async () => {
    // const exportedData = await getExportMyData();
    // const binaryData = exportedData.data;
    // console.log(binaryData);
    // const blob = new Blob([binaryData], { type: "text/plain" });
    // const url = URL.createObjectURL(blob);
    // const a = document.createElement("a");
    // a.href = url;
    // a.download = "mydata.json";
    // document.body.appendChild(a);
    // a.click();
    // document.body.removeChild(a);
    // URL.revokeObjectURL(url);
  };

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.manageData.title')}
      />
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
            bgColor={config?.colors?.secondary || theme.surfaceHighlight}
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
            text={t('action.deleteMyAccount')}
            color={theme.danger}
          />
        </SharedSettingsColumnContainer>
      </SharedSettingsCenterContainer>
    </ModalContainerFullScreen>
  );
};

export default ManageDataModal;
