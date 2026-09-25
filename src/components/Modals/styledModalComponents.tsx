/** @format */

import styled from 'styled-components/native';
import Button from '../styled/Button';

export const ModalBackground = styled.View`
  width: 100%;
  height: 100%;
  background: ${({ theme }) => theme.overlay};
  flex: 1;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

export const CloseButton = styled.TouchableOpacity`
  position: absolute;
  top: 16px;
  right: 16px;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: ${({ theme }) => theme.textMuted};
`;

/** The "×" glyph inside CloseButton — themed so it reads on dark surfaces. */
export const CloseButtonText = styled.Text`
  font-size: 24px;
  color: ${({ theme }) => theme.text};
`;

export const ModalContainer = styled.View`
  // flex: 1;
  // width: 100%;
  // height: 100%;
  background: ${({ theme }) => theme.surface};
  padding: 32px 64px;
  box-shadow: 0px 4px 16px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 32px;
  position: relative;
  justify-content: center;
  align-items: center;
`;

export const ModalTitle = styled.Text`
  color: ${({ theme }) => theme.text};
  font-size: 20px;
  margin: 0;
  font-weight: 400;
`;

export const ModalDescription = styled.Text`
  color: ${({ theme }) => theme.text};
  font-size: 14px;
  margin: 0;
  font-weight: 400;
`;

export const GroupContainer = styled.View`
  display: flex;
  gap: 16px;
  width: 100%;
  padding: 0;
`;

export const ModalContainerFullScreen = styled.View`
  width: 100%;
  height: 100%;
  background-color: ${({ theme }) => theme.surface};
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  overflow-y: auto;
`;

export const HeaderContainer = styled.View`
  position: relative;
  top: 0;
  width: 100%;
  /* The previous incarnation had padding-top:62px (hard-coded status-bar
   * offset) clamped to min/max-height:24px — content overflowed the
   * visible band and the back arrow hugged the bottom edge. The earlier
   * fix dropped the clamp but kept a hard-coded 56px top inset, which on
   * top of this modal's absolute-fill overlay (no system inset is auto-
   * applied) made the header eat far more space than it should.
   *
   * Now: compact 8px vertical padding here; the dynamic top inset for
   * the status bar / Dynamic Island is supplied by ModalHeaderComponent
   * via useSafeAreaInsets() — accurate per-device (~59px on a 16 Pro,
   * 20px on an SE). Together that's status-bar + 8px above the back
   * button and 8px below — properly sized and properly centered. */
  padding: 8px 16px;
  background-color: ${({ theme }) => theme.surface};
  /* Same card treatment as the room-list header: rounded bottom corners
   * and a soft drop shadow instead of a hairline rule. */
  border-bottom-left-radius: 20px;
  border-bottom-right-radius: 20px;
  shadow-color: ${({ theme }) => theme.shadow};
  shadow-offset: 0px 4px;
  shadow-opacity: 0.06;
  shadow-radius: 12px;
  elevation: 4;
  z-index: 1;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
`;

export const HeaderLeft = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 16px;
`;

export const HeaderRight = styled.View`
  flex-direction: row;
  align-items: center;
  gap: 16px;
`;

export const CenterContainer = styled(GroupContainer)`
  width: 100%;
  padding: 16px;
  flex-direction: column;
  align-items: center;
`;

export const ProfileImage = styled.View`
  width: 120px;
  height: 120px;
  border-radius: 10000px;
  border: 1px solid ${({ theme }) => theme.border};
`;

export const UserInfo = styled.View`
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
`;

export const UserName = styled.Text<{
  fontSize?: number;
  fontWeight?: string;
}>`
  color: ${({ theme }) => theme.text};
  font-size: ${({ fontSize }) => fontSize ?? 24}px;
  font-weight: ${({ fontWeight }) => fontWeight ?? 400};
`;

export const UserStatus = styled.Text`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 16px;
  font-weight: 400;
`;

export const BorderedContainer = styled.View`
  width: 100%;
  border-radius: 8px;
  border: 1px solid ${({ theme }) => theme.border};
  display: flex;
  flex-direction: column;
  padding: 16px;
`;

export const LabelData = styled.Text`
  color: ${({ theme }) => theme.textSecondary};
  font-size: 14px;
  font-weight: 400;
`;

export const Label = styled.Text`
  color: ${({ theme }) => theme.text};
  font-size: 16px;
`;

export const ActionButton = styled(Button)`
  width: 100%;
`;

export const EmptySection = styled.View`
  height: 200px;
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 8px;
  width: 100%;
  display: flex;
`;

export const Viewider = styled.View`
  height: 1px;
  width: 100%;
  background-color: ${({ theme }) => theme.surfaceHighlight};
`;

export const Divider = styled.View`
  height: 1px;
  width: 100%;
  background-color: ${({ theme }) => theme.surfaceHighlight};
`;
