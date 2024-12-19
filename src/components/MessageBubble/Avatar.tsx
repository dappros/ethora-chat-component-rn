import React, {useMemo} from 'react';
import styled from 'styled-components/native';

interface AvatarProps {
  username?: string;
  firstName?: string;
  lastName?: string;
  style?: object;
}

const backgroundColors = ['#f44336', '#2196f3', '#4caf50', '#ff9800'];

const AvatarCircle = styled.View<{bgColor: string}>`
  width: 40px;
  height: 40px;
  border-radius: 20px;
  background-color: ${({bgColor}) => bgColor};
  align-items: center;
  justify-content: center;
  shadow-color: rgba(0, 0, 0, 0.2);
  shadow-offset: 0px 4px;
  shadow-opacity: 0.2;
  shadow-radius: 4px;
  elevation: 4;
`;

const AvatarText = styled.Text<{textColor: string}>`
  font-size: 16px;
  font-weight: bold;
  color: ${({textColor}) => textColor};
`;

export const Avatar: React.FC<AvatarProps> = ({
  username,
  firstName,
  lastName,
  style,
}) => {
  const getInitials = () => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    } else if (username) {
      const names = username.split(' ');
      return names.length > 1
        ? `${names[0][0]}${names[1][0]}`.toUpperCase()
        : `${names[0][0]}`.toUpperCase();
    }
    return '??';
  };

  const randomColor = useMemo(() => {
    const index = Math.floor(Math.random() * backgroundColors.length);
    return backgroundColors[index];
  }, []);

  const getTextColor = (bgColor: string) => {
    const lightColors = ['#4caf50', '#ff9800'];
    return lightColors.includes(bgColor) ? '#000' : '#fff';
  };

  const initials = getInitials();
  const bgColor = randomColor;
  const textColor = getTextColor(bgColor);

  return (
    <AvatarCircle style={style} bgColor={bgColor}>
      <AvatarText textColor={textColor}>{initials}</AvatarText>
    </AvatarCircle>
  );
};
