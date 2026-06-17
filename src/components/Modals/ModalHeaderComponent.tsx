import React from 'react';
import {
  HeaderContainer,
  HeaderLeft,
  HeaderRight,
} from './styledModalComponents';
import { BackIcon, MoreIcon, QrIcon } from '../../assets/icons';
import Button from '../styled/Button';
import { Text, StyleProp, TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { resolveHeaderHeight } from '../../helpers/headerLayout';
import { useChatSettingState } from '../../hooks/useChatSettingState';

interface ModalHeaderComponentProps {
  handleCloseModal?: any;
  headerTitle?: string;
  /** Optional size/weight override for the header title text. */
  titleStyle?: StyleProp<TextStyle>;
  rightMenu?: React.ReactNode;
  leftMenu?: React.ReactNode;
}

const ModalHeaderComponent: React.FC<ModalHeaderComponentProps> = ({
  handleCloseModal,
  headerTitle,
  titleStyle,
  rightMenu,
  leftMenu,
}) => {
  // The library's full-screen modals are an absolute-fill overlay inside
  // ModalBackground (NOT a native Modal), so the OS doesn't apply any
  // status-bar inset automatically — we have to. SafeAreaProvider is
  // mounted by ReduxWrapper, so this reads the live per-device inset
  // (notch / Dynamic Island / nothing).
  const insets = useSafeAreaInsets();
  const { config } = useChatSettingState();
  // Same band height as the in-chat header, sitting BELOW the status-bar
  // inset. Total = inset + band; paddingTop carries the inset and the band
  // is the content area (centered via HeaderContainer's align-items:center),
  // so both headers match in visible height regardless of device notch.
  const band = resolveHeaderHeight(config?.headerLayout?.height);
  return (
    <HeaderContainer
      style={{
        paddingTop: insets.top,
        paddingBottom: 0,
        height: insets.top + band,
      }}
    >
      <HeaderLeft>
        {leftMenu ? (
          leftMenu
        ) : (
          <>
            <Button EndIcon={<BackIcon />} onPress={handleCloseModal} />
            <Text style={titleStyle}>{headerTitle ?? 'Go back'}</Text>
          </>
        )}
      </HeaderLeft>
      <HeaderRight>{rightMenu}</HeaderRight>
    </HeaderContainer>
  );
};

export default ModalHeaderComponent;
