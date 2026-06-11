import React, { useMemo } from 'react';
import styled from 'styled-components/native';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import {
  getAvatarColor,
  getAvatarTextColor,
} from '../../helpers/getAvatarColor';

interface AvatarProps {
  username?: string | null;
  firstName?: string;
  lastName?: string;
  style?: object;
}

const AvatarCircle = styled.View<{ bgColor?: string }>`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: ${({ bgColor }) => bgColor};
  align-items: center;
  justify-content: center;
  shadow-color: rgba(0, 0, 0, 0.2);
  shadow-offset: 0px 4px;
  shadow-opacity: 0.2;
  shadow-radius: 4px;
  elevation: 4;
`;

const AvatarText = styled.Text<{ color?: string }>`
  font-size: 16px;
  font-weight: bold;
  // Pastel backgrounds from the hash palette are all light, so the
  // default is dark text; a configured colors.avatar may be dark, in
  // which case getAvatarTextColor flips this to white.
  color: ${({ color }) => color || '#141414'};
`;

export const Avatar: React.FC<AvatarProps> = ({
  username,
  firstName,
  lastName,
  style,
}) => {
  const { config } = useChatSettingState();
  const backgroundColor = useMemo(() => {
      if (!username && !firstName) {
        return { backgroundColor: 'transparent' };
      }
      return {
        backgroundColor: getAvatarColor(username || firstName, config),
      };
    }, [username, firstName, config]);

  const getInitials = () => {
    const isAlphabetic = (char: string) => /^[a-zA-Zа-яА-ЯёЁ]$/.test(char);

    if (firstName && lastName) {
      const firstInitial = isAlphabetic(firstName[0])
        ? firstName[0].toUpperCase()
        : '';
      const lastInitial = isAlphabetic(lastName[0])
        ? lastName[0].toUpperCase()
        : '';
      return `${firstInitial}${lastInitial}`;
    } else if (username) {
      const names = username.split(' ');
      if (names.length > 1) {
        const firstInitial = isAlphabetic(names[0][0])
          ? names[0][0].toUpperCase()
          : '';
        const secondInitial = isAlphabetic(names[1][0])
          ? names[1][0].toUpperCase()
          : '';
        return `${firstInitial}${secondInitial}`;
      } else {
        const singleInitial = isAlphabetic(names[0][0])
          ? names[0][0].toUpperCase()
          : '';
        return `${singleInitial}`;
      }
    }
    return '??';
  };

  return (
    <AvatarCircle style={style} bgColor={backgroundColor?.backgroundColor}>
      <AvatarText color={getAvatarTextColor(backgroundColor?.backgroundColor)}>
        {getInitials()}
      </AvatarText>
    </AvatarCircle>
  );
};
