import React, { useMemo, useState } from "react";
import styled from "styled-components/native";
import {
  CenterContainer,
  ModalContainerFullScreen,
} from "../styledModalComponents";
import { SaveIcon } from "../../../assets/icons";
import ModalHeaderComponent from "../ModalHeaderComponent";
import { useDispatch, useSelector } from "react-redux";
import Button from "../../styled/Button";
import { RootState } from "../../../roomStore";
import { FullScreenImage } from "../../styled/StyledInputComponents/MediaComponents";
import { setActiveFile } from "../../../roomStore/chatSettingsSlice";
import { Alert, Text, View, PermissionsAndroid, Platform } from "react-native";
import Video, { VideoRef } from "react-native-video";
import RNFS from "react-native-fs";
import Toast from "../../Toast/Toast";
import Share from "react-native-share";
import DocumentPicker from "react-native-document-picker";
export const FullScreenVideo = styled.View`
  width: 100%;
  height: 100%;
  object-fit: contain;
`;

interface FilePreviewModalProps {
  handleCloseModal: any;
}

const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useDispatch();
  const { activeFile } = useSelector(
    (state: RootState) => state.chatSettingStore
  );
  const [toastVisible, setToastVisible] = useState(false);

  if (!activeFile) return;

  const requestStoragePermission = async () => {
    try {
      if (Platform.OS === "android") {
        if (Platform.Version >= 33) {
          const permissions = [
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_VIDEO,
            PermissionsAndroid.PERMISSIONS.READ_MEDIA_AUDIO,
          ];

          const granted = await PermissionsAndroid.requestMultiple(permissions);

          if (
            granted["android.permission.READ_MEDIA_IMAGES"] ===
              PermissionsAndroid.RESULTS.GRANTED &&
            granted["android.permission.READ_MEDIA_VIDEO"] ===
              PermissionsAndroid.RESULTS.GRANTED &&
            granted["android.permission.READ_MEDIA_AUDIO"] ===
              PermissionsAndroid.RESULTS.GRANTED
          ) {
            return true;
          } else {
            return false;
          }
        } else if (Platform.Version >= 30) {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
            {
              title: "Storage Permission Required",
              message:
                "This app needs access to your storage to download and save files.",
              buttonPositive: "OK",
            }
          );

          if (granted === PermissionsAndroid.RESULTS.GRANTED) {
            return true;
          } else {
            return false;
          }
        }
      }

      return true;
    } catch (error) {
      console.error("Error requesting permission:", error);
      return false;
    }
  };

  const saveClick = async () => {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      Alert.alert(
        "Permission Denied",
        "Storage permission is required to save files."
      );
      return;
    }

    try {
      // Запрашиваем выбор папки
      const result = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types.allFiles],
        allowMultiSelection: false,
      });

      if (result && result.uri) {
        // Скачиваем файл во временную директорию
        const downloadDest = `${RNFS.TemporaryDirectoryPath}/${
          activeFile.fileName || "MEDIA-ETHORA"
        }`;

        const res = await RNFS.downloadFile({
          fromUrl: activeFile.fileURL,
          toFile: downloadDest,
        }).promise;

        if (res.statusCode === 200) {
          // Используем Share для сохранения в выбранную папку
          await Share.open({
            url: `file://${downloadDest}`,
            saveToFiles: true,
          });

          Alert.alert("Success", "File saved successfully!");
        } else {
          Alert.alert("Error", "Failed to save the file.");
        }
      }
    } catch (err) {
      if (DocumentPicker.isCancel(err)) {
        console.log("User cancelled the picker");
      } else {
        console.error("Error saving file:", err);
        Alert.alert("Error", "Failed to save the file.");
      }
    }
  };

  const closeModal = () => {
    dispatch(
      setActiveFile({
        fileName: "",
        fileURL: "",
        mimetype: "",
      })
    );
    handleCloseModal?.();
  };

  const getMediaComponent = useMemo(() => {
    switch (true) {
      case activeFile.mimetype.startsWith("image/"):
        return (
          <FullScreenImage
            src={
              activeFile.fileURL ||
              "https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg"
            }
            alt={activeFile.fileName}
          />
        );
      case activeFile.mimetype.startsWith("video/"):
        return (
          <Video
            style={{
              width: "100%",
              height: "100%",
            }}
            source={{ uri: activeFile.fileURL }}
            controls
            resizeMode="contain"
            paused={true}
          />
        );
      default:
        return (
          <View
            style={{
              backgroundColor: "#FFF8ED",
              borderRadius: 16,
              display: "flex",
              padding: 16,
            }}
          >
            <Text>
              Unable to open the uploaded document. The file format is not
              supported by the system. Please upload a file in a compatible
              format. You still can dowload this file.
            </Text>
          </View>
        );
    }
  }, [activeFile]);

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={closeModal}
        headerTitle={"File preview"}
        rightMenu={
          <>
            <Button onPress={saveClick}>
              <SaveIcon />
            </Button>
            {/* <Button onClick={deleteCLick}>
              <DeleteIcon />
            </Button> */}
          </>
        }
      />

      <CenterContainer
        style={{
          display: "flex",
          height: "100%",
          justifyContent: "center",
          overflow: "hidden",
          padding: 16,
        }}
      >
        {getMediaComponent}
      </CenterContainer>

      <Toast
        visible={toastVisible}
        message="File saved successfully!"
        duration={1500}
      />
    </ModalContainerFullScreen>
  );
};

export default FilePreviewModal;
