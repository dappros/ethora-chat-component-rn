import { View } from "react-native";
import { MediaContainer, MediaImage } from "./StyledInputComponents/StyledInputComponents";
import { FileIcon } from "../../assets/icons";
import { RemoveButton, RemoveButtonText } from "./StyledComponents";
import { FC } from "react";
import { MediaFile } from "../../types/types";

interface MediaFilePreviewProps {
  filePreviews: MediaFile[];
  handleRemoveImage: (index: number) => void
}

export const MediaFilePreview: FC<MediaFilePreviewProps> = ({
                                                              filePreviews,
                                                              handleRemoveImage,
                                                            }) => {
  return (
    <MediaContainer>
      {filePreviews.map((file, index) => {
        const isImageOrVideo = file.type?.startsWith('image') || file.type?.startsWith('video');
        return (
          <View key={`${file.name}_${index}`}>
            {isImageOrVideo ? (
              <MediaImage source={{ uri: file.uri }} />
            ) : (
              <View style={{width: 70, height: 70, borderRadius: 8}}>
                <FileIcon width={70} height={70}/>
              </View>
            )}
            <RemoveButton onPress={() => handleRemoveImage(index)}>
              <RemoveButtonText>&times;</RemoveButtonText>
            </RemoveButton>
          </View>
        )
      })}
    </MediaContainer>
  )
}