import React from 'react';
import {
  HeaderContainer,
  HeaderLeft,
  HeaderRight,
} from './styledModalComponents';
import { BackIcon, MoreIcon, QrIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ModalHeaderComponentProps {
  handleCloseModal?: any;
  headerTitle?: string;
  rightMenu?: React.ReactNode;
  leftMenu?: React.ReactNode;
}

const ModalHeaderComponent: React.FC<ModalHeaderComponentProps> = ({
  handleCloseModal,
  headerTitle,
  rightMenu,
  leftMenu,
}) => {
  // The library's full-screen modals are an absolute-fill overlay inside
  // ModalBackground (NOT a native Modal), so the OS doesn't apply any
  // status-bar inset automatically — we have to. SafeAreaProvider is
  // mounted by ReduxWrapper, so this reads the live per-device inset
  // (notch / Dynamic Island / nothing).
  const insets = useSafeAreaInsets();
  return (
    <HeaderContainer style={{ paddingTop: insets.top + 8 }}>
      <HeaderLeft>
        {leftMenu ? (
          leftMenu
        ) : (
          <>
            <Button EndIcon={<BackIcon />} onPress={handleCloseModal} />
            <Text>{headerTitle ?? 'Go back'}</Text>
          </>
        )}
      </HeaderLeft>
      <HeaderRight>{rightMenu}</HeaderRight>
    </HeaderContainer>
  );
};

export default ModalHeaderComponent;
