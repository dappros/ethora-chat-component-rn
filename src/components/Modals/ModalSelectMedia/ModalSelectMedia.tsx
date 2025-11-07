import React, { FC, useMemo } from "react";
import { Alert, Linking, Platform } from "react-native";
import Button from "../../styled/Button";
import DropdownMenu from "../../DropdownMenu/DropdownMenu";
import DocumentPicker from "react-native-document-picker";
import ImagePicker from "react-native-image-crop-picker";
import {
  check,
  request,
  PERMISSIONS,
  RESULTS,
  Permission,
} from "react-native-permissions";
import {
  AttachIcon,
  CameraIcon,
  DocumentIcon,
  MediaIcon,
} from "../../../assets/icons";
import { MediaFile } from "../../../types/types";

interface ModalSelectMediaProps {
  onFileSelect: (files: MediaFile[]) => void;
}

interface Permissions {
  UNAVAILABLE: "unavailable";
  BLOCKED: "blocked";
  DENIED: "denied";
  GRANTED: "granted";
  LIMITED: "limited";
}

export const ModalSelectMedia: FC<ModalSelectMediaProps> = ({
  onFileSelect,
}) => {
  const checkPermission = async (permission: Permission) => {
    const status = await check(permission);

    if (status === RESULTS.GRANTED) {
      return status;
    } else if (status === RESULTS.DENIED) {
      const requestStatus = await request(permission);
      if (requestStatus === RESULTS.GRANTED) {
        return requestStatus;
      } else if (requestStatus === RESULTS.DENIED) {
        return requestStatus;
      }
    } else if (status === RESULTS.UNAVAILABLE) {
      return status;
    } else {
      console.log(status);
      return status;
    }
  };

  const handleCameraSelection = async () => {
    const permission =
      Platform.OS === "ios"
        ? PERMISSIONS.IOS.CAMERA
        : PERMISSIONS.ANDROID.CAMERA;
    const permissionStatus = await checkPermission(permission);

    if (permissionStatus !== RESULTS.GRANTED) {
      Alert.alert(
        "Permission required",
        "Camera permission is needed to take photos.",
        [
          {
            text: "Cancel",
            onPress: () => console.log("Camera permission cancelled"),
            style: "cancel",
          },
          {
            text: "Open Settings",
            onPress: () => Linking.openSettings(),
          },
        ]
      );
      return;
    }

    try {
      const image = await ImagePicker.openCamera({
        width: 300,
        height: 400,
        cropping: true,
      });

      const originalName = image.path.split("/").pop();
      const file = {
        uri: image.path,
        type: image.mime,
        name: originalName || `camera_${Date.now()}.jpg`,
      };
      onFileSelect([file]);
    } catch (error) {
      console.error("Camera error:", error);
    }
  };

  const handleGallerySelection = async () => {
    let permission: Permission;

    if (Platform.OS === "ios") {
      permission = PERMISSIONS.IOS.PHOTO_LIBRARY;
    } else if (Number(Platform.Version) >= 33) {
      permission = PERMISSIONS.ANDROID.READ_MEDIA_IMAGES;
    } else {
      permission = PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE;
    }

    const permissionStatus = await checkPermission(permission);

    if (permissionStatus !== RESULTS.GRANTED) {
      Alert.alert(
        "Permission required",
        "Gallery permission is needed to select photos.",
        [
          {
            text: "Cancel",
            onPress: () => console.log("Gallery permission cancelled"),
            style: "cancel",
          },
          {
            text: "Open Settings",
            onPress: () => Linking.openSettings(),
          },
        ]
      );
      return;
    }

    try {
      const image = await ImagePicker.openPicker({
        multiple: false,
        mediaType: "any",
      });

      const originalName = image.path.split("/").pop();
      const file = {
        uri: image.path,
        type: image.mime,
        name:
          originalName ||
          `gallery_${Date.now()}${
            image.mime.includes("video") ? ".mp4" : ".jpg"
          }`,
      };

      onFileSelect([file]);
    } catch (error) {
      console.error("Gallery error:", error);
    }
  };

  const handleFileSelection = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: false,
      });

      const files = result.map((file) => {
        const originalName = file.name;
        return {
          uri: file.uri,
          type: file.type || "unknown",
          name: originalName || `file_${Date.now()}`,
        };
      });

      onFileSelect(files);
    } catch (err) {
      if (DocumentPicker.isCancel(err)) {
        console.log("User cancelled file picker");
      } else {
        console.error("DocumentPicker Error:", err);
      }
    }
  };

  const menuOptions = useMemo(
    () => [
      {
        label: "Camera",
        icon: <CameraIcon />,
        onClick: async () => {
          setTimeout(async () => {
            await handleCameraSelection();
            console.log("Open camera");
          }, 500);
        },
      },
      {
        label: "Media File",
        icon: <MediaIcon />,
        onClick: async () => {
          setTimeout(async () => {
            await handleGallerySelection();
            console.log("Open gallery");
          }, 500);
        },
      },
      {
        label: "Document",
        icon: <DocumentIcon />,
        onClick: async () => {
          setTimeout(async () => {
            console.log("document");
            await handleFileSelection();
          }, 500);
        },
      },
    ],
    []
  );

  return (
    <DropdownMenu
      position="leftBottom"
      options={menuOptions}
      openButton={(onPress) => (
        <Button
          style={{ padding: 8, maxHeight: 40 }}
          EndIcon={<AttachIcon />}
          unstyled
          onPress={onPress}
        />
      )}
    />
  );
};
