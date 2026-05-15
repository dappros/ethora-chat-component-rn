import React from 'react';

import {
  ModalContainerFullScreen,
  Viewider,
  Label,
  LabelData,
  BorderedContainer,
  CenterContainer,
} from '../../styledModalComponents';
import ModalHeaderComponent from '../../ModalHeaderComponent';
import Button from '../../../styled/Button';
import { ReferalsIcon, SendCoinIcon } from '../../../../assets/icons';
import {
  RowWrapper,
  SharedSettingsColumnContainer,
  SharedSettingsStyledLabel,
} from '../SharedStyledComponents';
import InputWithLabel from '../../../styled/StyledInput';
import { StyledInput } from '../../../styled/StyledInputComponents/StyledInputComponents';
import { useSelector } from 'react-redux';
import { RootState } from '../../../../roomStore';
import { View, Text } from 'react-native';
import Animated from 'react-native-reanimated';

interface ReferralsModalProps {
  handleCloseModal: any;
}

const ReferralsModal: React.FC<ReferralsModalProps> = ({
  handleCloseModal,
}) => {
  const { config } = useSelector((state: RootState) => state.chatSettingStore);

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={handleCloseModal}
        headerTitle={'Referrals'}
      />
      <CenterContainer>
        <ReferalsIcon />
        <Animated.View>
          <SharedSettingsStyledLabel>Gift friends 25</SharedSettingsStyledLabel>
          <SendCoinIcon style={{ width: 24, height: 24 }} />
          <SharedSettingsStyledLabel>and receive 25</SharedSettingsStyledLabel>
          <SendCoinIcon style={{ width: 24, height: 24 }} />
          <Text>.</Text>
          <SharedSettingsStyledLabel>
            Send friends invite with your personal invitation code.
          </SharedSettingsStyledLabel>
        </Animated.View>
        <SharedSettingsColumnContainer style={{ width: '100%' }}>
          <SharedSettingsStyledLabel>
            Your invitation code
          </SharedSettingsStyledLabel>
          <StyledInput
            color={config?.colors?.primary || ''}
            placeholder="Your invitation code"
            // label={'About'}
            // value={message}
            // onChange={handleInputChange}
            // onKeyDown={handleKeyDown}
            // onFocus={handleFocus}
            // onBlur={handleBlur}
            // disabled={isLoading}
          />
        </SharedSettingsColumnContainer>
        <SharedSettingsColumnContainer style={{ width: '100%' }}>
          <SharedSettingsStyledLabel>
            Or enter your referral code to earn coins
          </SharedSettingsStyledLabel>
          <StyledInput
            color={config?.colors?.primary}
            placeholder="Your referral code"
            // label={'About'}
            // value={message}
            // onChange={handleInputChange}
            // onKeyDown={handleKeyDown}
            // onFocus={handleFocus}
            // onBlur={handleBlur}
            // disabled={isLoading}
          />
        </SharedSettingsColumnContainer>
      </CenterContainer>
    </ModalContainerFullScreen>
  );
};

export default ReferralsModal;
