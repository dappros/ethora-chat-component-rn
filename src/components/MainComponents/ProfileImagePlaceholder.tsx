import React, { useMemo } from "react";
import styled from "styled-components/native";
import { TouchableOpacity, Image, Text } from "react-native";
import { EditIcon } from "../../assets/icons";
import {
  AvatarCircle,
  AvatarImage,
  InitialsText,
  Overlay,
  RemoveButton,
  RemoveButtonText,
  Wrapper,
} from "../styled/StyledComponents";
import { nameToColor } from "../../helpers/constants/hashcolor";

interface ProfileImagePlaceholderProps {
  name?: string;
  icon?: string | { uri: string };
  click?: {
    onPress: () => void;
    isClick: boolean;
  };
  size?: number;
  upload?: {
    onUpload: (image: any) => void; // Replace `any` with a proper type if available
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

const backgroundColors = ["#f44336", "#2196f3", "#4caf50", "#ff9800"];

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
  const { backgroundColor, textColor } = nameToColor(name || "");

  const getTwoUppercaseLetters = (fullName: string) => {
    if (!fullName) return "";

    const words = fullName.trim().split(" ");
    const firstLetter = words[0]?.[0]?.toUpperCase() || "";
    const secondLetter = words[words.length - 1]?.[0]?.toUpperCase() || "";

    return firstLetter + secondLetter;
  };

  const getInitials = () => (!icon && name ? getTwoUppercaseLetters(name) : "");

  return (
    <Wrapper
      bgColor={icon ? "transparent" : backgroundColor}
      size={size}
      isClickable={active || !!upload?.active}
    >
      <AvatarCircle
        bgColor={icon ? "transparent" : backgroundColor}
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
            source={typeof icon === "string" ? { uri: icon } : icon}
            size={size}
          />
        ) : placeholderIcon ? (
          placeholderIcon
        ) : (
          <InitialsText size={size} color={textColor || ""}>
            {getInitials()}
          </InitialsText>
        )}
        {upload?.active && !disableOverlay && (
          <Overlay>
            <EditIcon style={{ fontSize: size / 2 }} color="#fff" />
          </Overlay>
        )}
      </AvatarCircle>
      {remove?.enabled && icon && role !== "participant" && (
        <RemoveButton onPress={remove.onRemoveClick}>
          <RemoveButtonText>&times;</RemoveButtonText>
        </RemoveButton>
      )}
    </Wrapper>
  );
};
