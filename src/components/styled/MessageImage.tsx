import React, { useEffect, useState } from 'react';
import { Container } from './StyledInputComponents/MediaComponents';
import { useDispatch } from 'react-redux';
import {
  setActiveFile,
  setActiveModal,
} from '../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../helpers/constants/MODAL_TYPES';
import { ActivityIndicator, Image, TouchableOpacity, View } from 'react-native';
import {
  defaultMediaDims,
  fitMediaDimensions,
  MediaDims,
} from '../../helpers/mediaDimensions';

interface CustomMessageImageProps {
  fileURL: string;
  fileName: string;
  mimetype: string;
}

const FALLBACK_IMAGE =
  'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg';

const CustomMessageImage: React.FC<CustomMessageImageProps> = ({
  fileURL,
  fileName,
  mimetype,
}) => {
  const [loading, setLoading] = useState(true);
  // Start with a neutral box; swap to the real aspect ratio once the
  // image's natural dimensions are known so it's shown scaled, not cropped.
  const [dims, setDims] = useState<MediaDims>(defaultMediaDims());

  const dispatch = useDispatch();

  useEffect(() => {
    if (!fileURL) {
      return;
    }
    let active = true;
    Image.getSize(
      fileURL,
      (w, h) => {
        if (active) {
          setDims(fitMediaDimensions(w, h));
        }
      },
      () => {
        /* keep the default box if the size probe fails */
      }
    );
    return () => {
      active = false;
    };
  }, [fileURL]);

  const handleOpen = () => {
    dispatch(setActiveFile({ fileName, fileURL, mimetype }));
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  return (
    <Container style={{ width: dims.width }}>
      <TouchableOpacity onPress={handleOpen} activeOpacity={0.9}>
        {loading && (
          <View
            style={{
              position: 'absolute',
              width: dims.width,
              height: dims.height,
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
            }}
          >
            <ActivityIndicator size="small" color="#0052CD" />
          </View>
        )}
        <Image
          source={{ uri: fileURL || FALLBACK_IMAGE }}
          style={{
            width: dims.width,
            height: dims.height,
            borderRadius: 10,
            backgroundColor: 'rgba(0, 0, 0, 0)',
          }}
          onLoadEnd={() => setLoading(false)}
          // The box already matches the natural aspect ratio, so 'cover'
          // fills it edge-to-edge with no actual cropping or letterboxing.
          resizeMode="cover"
        />
      </TouchableOpacity>
    </Container>
  );
};

export default CustomMessageImage;
