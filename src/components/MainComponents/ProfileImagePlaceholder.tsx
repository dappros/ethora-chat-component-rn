import React, { useMemo } from 'react';
import styled from 'styled-components/native';
import { TouchableOpacity, Image, Text } from 'react-native';
import { EditIcon } from '../../assets/icons';
import {
  AvatarCircle,
  AvatarImage,
  InitialsText,
  Overlay,
  RemoveButton,
  RemoveButtonText,
  Wrapper,
} from '../styled/StyledComponents';
import { nameToColor } from '../../helpers/hashcolor';

interface ProfileImagePlaceholderProps {
  name?: string;
  icon?: string | { uri: string } | string | File | null;
  click?: {
    onPress: () => void;
    isClick: boolean;
  };
  size?: number;
  upload?: {
    onUpload: (image: any) => void;
    active: boolean;
  };
  remove?: {
    enabled: boolean;
    onRemoveClick: () => void;
  };
  role?: string;
  active?: boolean;
  placeholderIcon?: React.ReactNode;
  disableOverlay?: boolean;
}

export const ProfileImagePlaceholder: React.FC<
  ProfileImagePlaceholderProps
> = ({
  name,
  icon,
  click,
  size = 64,
  upload,
  remove,
  role,
  active = false,
  placeholderIcon,
  disableOverlay,
}) => {
  const backgroundColor = useMemo(() => {
    if(!name) {
      return { backgroundColor: 'transparent' };
    }
    return nameToColor(name);
  }, [name]);

  const getTwoUppercaseLetters = (fullName: string) => {
    if (!fullName) {return '';}

    const words = fullName.trim().split(' ').filter(word => word.length > 0);

    if (words.length === 0) {return '';}

    if (words.length >= 2) {
      const firstLetter = /^[a-zA-Zа-яА-ЯёЁ]$/.test(words[0]?.[0] || '')
        ? words[0][0].toUpperCase()
        : '';
      const secondLetter = /^[a-zA-Zа-яА-ЯёЁ]$/.test(words[1]?.[0] || '')
        ? words[1][0].toUpperCase()
        : '';
      return firstLetter + secondLetter;
    }

    if (words.length === 1 && words[0].length >= 2) {
      const firstLetter = /^[a-zA-Zа-яА-ЯёЁ]$/.test(words[0][0] || '')
        ? words[0][0].toUpperCase()
        : '';
      const secondLetter = /^[a-zA-Zа-яА-ЯёЁ]$/.test(words[0][1] || '')
        ? words[0][1].toUpperCase()
        : '';
      return firstLetter + secondLetter;
    }

    if (words.length === 1 && words[0].length === 1) {
      return /^[a-zA-Zа-яА-ЯёЁ]$/.test(words[0][0] || '')
        ? words[0][0].toUpperCase()
        : '';
    }

    return '';
  };

  const getInitials = () => (!icon && name ? getTwoUppercaseLetters(name) : '');

  return (
    <Wrapper
      bgColor={icon ? 'transparent' : backgroundColor?.backgroundColor}
      size={size}
      isClickable={active || !!upload?.active}
    >
      <AvatarCircle
        bgColor={icon ? 'transparent' : backgroundColor?.backgroundColor}
        size={size}
        isClickable={active || !!upload?.active}
        onPress={
          upload?.active
            ? upload.onUpload
            : click?.isClick
            ? click.onPress
            : undefined
        }
      >
        {icon ? (
          <AvatarImage
            source={typeof icon === 'string' ? { uri: icon } : icon}
            size={size}
          />
        ) : placeholderIcon ? (
          placeholderIcon
        ) : (
          <InitialsText size={size} color="#fff">
            {getInitials()}
          </InitialsText>
        )}
        {upload?.active && !disableOverlay && (
          <Overlay>
            <EditIcon style={{ fontSize: size / 2 }} color="#fff" />
          </Overlay>
        )}
      </AvatarCircle>
      {remove?.enabled && icon && role !== 'participant' && (
        <RemoveButton onPress={remove.onRemoveClick}>
          <RemoveButtonText>&times;</RemoveButtonText>
        </RemoveButton>
      )}
    </Wrapper>
  );
};
