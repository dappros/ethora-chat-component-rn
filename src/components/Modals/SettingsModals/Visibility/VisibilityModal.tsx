import { useEffect, useState } from 'react';
import { RadioGroup, RadioLabel } from './StyledComponents';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../../../roomStore';
import { setUser } from '../../../../roomStore/chatSettingsSlice';
import { Notification } from '../../../Toast';
import { updateMe } from '../../../../networking/api-requests/user.api';
import { User } from '../../../../types/types';
import { ModalContainerFullScreen } from '../../styledModalComponents';
import {
  SharedSettingsCenterContainer,
  SharedSettingsColumnContainer,
  SharedSettingsLabelData,
  SharedSettingsStyledLabel,
} from '../SharedStyledComponents';
import { RadioInput } from './RadioInput';
import { useTheme } from '../../../../hooks/useTheme';
import { useT } from '../../../../i18n/useT';

interface VisibilityModalProps {
  handleCloseModal: any;
}

const VisibilityModal: React.FC<VisibilityModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useDispatch();
  const { user } = useSelector((state: RootState) => state.chatSettingStore);
  const theme = useTheme();
  const t = useT();

  const doUpdateUser = (user: User) => dispatch(setUser(user));
  const [isProfileOpen, setIsProfileOpen] = useState(user?.isProfileOpen);
  const [isAssetsOpen, setIsAssetsOpen] = useState(user?.isAssetsOpen);
  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error';
  } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

  useEffect(() => {
    if (isProfileOpen !== user.isProfileOpen) {
      updateMe({ isProfileOpen })
        .then(({ data }) => {
          doUpdateUser(data.user);
          showNotification('Saved', 'success');
        })
        .catch(() => showNotification('Error', 'error'));
    }
  }, [isProfileOpen]);

  useEffect(() => {
    if (isAssetsOpen !== user?.isAssetsOpen) {
      updateMe({ isAssetsOpen })
        .then(({ data }) => {
          doUpdateUser(data.user);
          showNotification('Saved', 'success');
        })
        .catch(() => showNotification('Error', 'error'));
    }
  }, [isAssetsOpen]);

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={t('settings.visibility.title')}
      />
      <SharedSettingsCenterContainer>
        <SharedSettingsColumnContainer>
          <SharedSettingsStyledLabel>
            {t('settings.visibility.profileLabel')}
          </SharedSettingsStyledLabel>
          <RadioGroup>
            <RadioLabel>
              <RadioInput
                option={{ label: t('settings.visibility.open'), value: isProfileOpen }}
                radioColor={theme.primary}
                checked={isProfileOpen === true}
                onChange={() => setIsProfileOpen(true)}
              />
            </RadioLabel>

            <SharedSettingsLabelData>
              {t('settings.visibility.openDescription')}
            </SharedSettingsLabelData>
            <RadioLabel>
              <RadioInput
                option={{ label: t('settings.visibility.restricted'), value: isProfileOpen }}
                radioColor={theme.primary}
                checked={isProfileOpen === false}
                onChange={() => setIsProfileOpen(false)}
              />
            </RadioLabel>
            <SharedSettingsLabelData>
              {t('settings.visibility.restrictedDescription')}
            </SharedSettingsLabelData>
          </RadioGroup>
        </SharedSettingsColumnContainer>
        <SharedSettingsColumnContainer>
          <SharedSettingsStyledLabel>
            {t('settings.visibility.documentsLabel')}
          </SharedSettingsStyledLabel>
          <RadioGroup>
            <RadioLabel>
              <RadioInput
                option={{ label: t('settings.visibility.full'), value: isAssetsOpen }}
                radioColor={theme.primary}
                checked={isAssetsOpen === true}
                onChange={() => setIsAssetsOpen(true)}
              />
            </RadioLabel>
            <SharedSettingsLabelData>
              {t('settings.visibility.fullDescription')}
            </SharedSettingsLabelData>
            <RadioLabel>
              <RadioInput
                option={{ label: t('settings.visibility.individual'), value: isAssetsOpen }}
                radioColor={theme.primary}
                checked={isAssetsOpen === false}
                onChange={() => setIsAssetsOpen(false)}
              />
            </RadioLabel>
            <SharedSettingsLabelData>
              {t('settings.visibility.individualDescription')}
            </SharedSettingsLabelData>
          </RadioGroup>
        </SharedSettingsColumnContainer>
      </SharedSettingsCenterContainer>

      {notification && (
        <Notification type={notification.type}>
          {notification.message}
        </Notification>
      )}
    </ModalContainerFullScreen>
  );
};

export default VisibilityModal;
