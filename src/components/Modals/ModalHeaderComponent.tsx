import React from 'react';
import {
  HeaderContainer,
  HeaderLeft,
  HeaderRight,
} from './styledModalComponents';
import { BackIcon, MoreIcon, QrIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { Text } from 'react-native';

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
  return (
    <HeaderContainer>
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
