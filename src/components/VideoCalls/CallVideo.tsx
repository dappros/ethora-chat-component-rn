import React, { FC } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { loadWebRTC } from '../../calls/p2p/webrtcRuntime';
import { loadLiveKit } from './livekitRuntime';

interface CallVideoProps {
  /**
   * What the session snapshot hands out: a LiveKit track reference
   * (`{ participant, publication, source }`) or a p2p stream handle
   * (`{ streamURL }`).
   */
  source: any;
  style?: StyleProp<ViewStyle>;
  objectFit?: 'contain' | 'cover';
  mirror?: boolean;
  zOrder?: number;
}

/**
 * One video surface of a call, whichever transport it came from: LiveKit's
 * `<VideoTrack />` for a room track, the fork's `<RTCView />` for the stream
 * of a peer to peer connection. Renders nothing when the matching native
 * package is missing.
 */
export const CallVideo: FC<CallVideoProps> = ({
  source,
  style,
  objectFit,
  mirror,
  zOrder,
}) => {
  if (!source) {return null;}

  if (typeof source.streamURL === 'string') {
    const RTCView = loadWebRTC()?.RTCView;
    return RTCView ? (
      <RTCView
        streamURL={source.streamURL}
        style={style}
        objectFit={objectFit}
        mirror={mirror}
        zOrder={zOrder}
      />
    ) : null;
  }

  const VideoTrack = loadLiveKit()?.VideoTrack;
  return VideoTrack ? (
    <VideoTrack
      trackRef={source}
      style={style}
      objectFit={objectFit}
      mirror={mirror}
      zOrder={zOrder}
    />
  ) : null;
};

export default CallVideo;
