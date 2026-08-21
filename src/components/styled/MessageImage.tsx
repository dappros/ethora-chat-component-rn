import React, { useEffect, useState } from 'react';
import {
  isSecureFileUrl,
  requestFileTokenRecovery,
} from '../../helpers/secureFileUrl';
import { pushLog } from '../../utils/devLogger';
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
  /** Full-size file. Opened in the preview modal, NOT rendered inline. */
  fileURL: string;
  fileName: string;
  mimetype: string;
  /**
   * Server-generated thumbnail — what the bubble actually renders, same
   * as the web client. The full-size original can be many megabytes and,
   * for secure uploads, is served from a different (membership-gated)
   * route; rendering it inline is what left the bubbles blank.
   */
  locationPreview?: string;
}

/** Keep the personal file token out of the logs. */
const maskToken = (url?: string) =>
  (url || '').replace(/([?&]ft=)[^&]*/i, '$1<redacted>');

const FALLBACK_IMAGE =
  'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg';

const CustomMessageImage: React.FC<CustomMessageImageProps> = ({
  fileURL,
  fileName,
  mimetype,
  locationPreview,
}) => {
  // Preview first, original only as a fallback — mirrors the web client,
  // where the <img> src is the preview and `fileURL` is reserved for the
  // modal.
  const displayURL = locationPreview || fileURL;
  const [loading, setLoading] = useState(true);
  // Start with a neutral box; swap to the real aspect ratio once the
  // image's natural dimensions are known so it's shown scaled, not cropped.
  const [dims, setDims] = useState<MediaDims>(defaultMediaDims());

  const dispatch = useDispatch();

  useEffect(() => {
    if (!displayURL) {
      return;
    }
    let active = true;
    Image.getSize(
      displayURL,
      (w, h) => {
        if (active) {
          setDims(fitMediaDimensions(w, h));
        }
      },
      (error) => {
        // Keep the default box — but say WHICH url failed. A blank
        // bubble is otherwise indistinguishable between "bad url",
        // "403 without a token" and "host unreachable".
        pushLog('warn', 'image: getSize failed', {
          url: maskToken(displayURL),
          error: (error as any)?.message || String(error),
        });
      }
    );
    return () => {
      active = false;
    };
  }, [displayURL]);

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
          source={{ uri: displayURL || FALLBACK_IMAGE }}
          style={{
            width: dims.width,
            height: dims.height,
            borderRadius: 10,
            backgroundColor: 'rgba(0, 0, 0, 0)',
          }}
          onLoadEnd={() => setLoading(false)}
          onError={(event) => {
            setLoading(false);
            pushLog('warn', 'image: load failed', {
              url: maskToken(displayURL),
              usingPreview: !!locationPreview,
              error: (event as any)?.nativeEvent?.error,
            });
            if (isSecureFileUrl(displayURL)) {
              requestFileTokenRecovery();
            }
          }}
          // The box already matches the natural aspect ratio, so 'cover'
          // fills it edge-to-edge with no actual cropping or letterboxing.
          resizeMode="cover"
        />
      </TouchableOpacity>
    </Container>
  );
};

export default CustomMessageImage;
