import React, { FC } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoCallIcons } from '../../types/types';
import {
  CameraOffIcon,
  CameraOnIcon,
  HangUpIcon,
  MicOffIcon,
  MicOnIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SwitchCameraIcon,
} from './CallIcons';
import {
  switchCallCamera,
  toggleCallCamera,
  toggleCallMic,
  toggleCallSpeaker,
} from './callSessionController';
import type { CallSessionSnapshot } from './callSessionTypes';
import { useT } from '../../i18n/useT';

const TEXT_ON_DARK = '#FFFFFF';
const DANGER = '#E53935';
const CONTROL_IDLE = 'rgba(255, 255, 255, 0.16)';

interface CallControlBarProps {
  session: Pick<CallSessionSnapshot, 'micOn' | 'cameraOn' | 'speakerOn'>;
  isVideo: boolean;
  icons?: VideoCallIcons;
  onHangup: () => void;
}

/**
 * The row of round buttons at the foot of the call screen: mic, camera (and
 * its flip), speaker and hang up. Shared by the 1:1 and the group layout; the
 * controls act on whichever transport carries the call.
 */
export const CallControlBar: FC<CallControlBarProps> = ({
  session,
  isVideo,
  icons,
  onHangup,
}) => {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { micOn, cameraOn, speakerOn } = session;

  return (
    <View style={[styles.controls, { paddingBottom: 20 + insets.bottom }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={micOn ? t('call.action.muteMic') : t('call.action.unmuteMic')}
        onPress={toggleCallMic}
        style={[styles.controlButton, { backgroundColor: micOn ? CONTROL_IDLE : DANGER }]}
      >
        {micOn
          ? (icons?.micOn ?? <MicOnIcon color={TEXT_ON_DARK} />)
          : (icons?.micOff ?? <MicOffIcon color={TEXT_ON_DARK} />)}
      </TouchableOpacity>

      {isVideo && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={
            cameraOn ? t('call.action.stopCamera') : t('call.action.startCamera')
          }
          onPress={toggleCallCamera}
          style={[styles.controlButton, { backgroundColor: cameraOn ? CONTROL_IDLE : DANGER }]}
        >
          {cameraOn
            ? (icons?.cameraOn ?? <CameraOnIcon color={TEXT_ON_DARK} />)
            : (icons?.cameraOff ?? <CameraOffIcon color={TEXT_ON_DARK} />)}
        </TouchableOpacity>
      )}

      {isVideo && cameraOn && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.switchCamera')}
          onPress={switchCallCamera}
          style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
        >
          <SwitchCameraIcon color={TEXT_ON_DARK} />
        </TouchableOpacity>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={speakerOn ? t('call.action.speakerOff') : t('call.action.speakerOn')}
        onPress={toggleCallSpeaker}
        style={[styles.controlButton, { backgroundColor: CONTROL_IDLE }]}
      >
        {speakerOn ? <SpeakerIcon color={TEXT_ON_DARK} /> : <SpeakerOffIcon color={TEXT_ON_DARK} />}
      </TouchableOpacity>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('call.action.hangUp')}
        onPress={onHangup}
        style={[styles.controlButton, styles.hangupButton]}
      >
        {icons?.hangup ?? <HangUpIcon color={TEXT_ON_DARK} />}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 20,
    paddingHorizontal: 16,
  },
  controlButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangupButton: {
    backgroundColor: DANGER,
  },
});

export default CallControlBar;
