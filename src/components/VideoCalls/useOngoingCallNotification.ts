import { useEffect, useRef } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { useT } from '../../i18n/useT';
import type {
  OngoingCallNotification,
  OngoingCallNotificationAction,
} from '../../types/types';
import { terminateActiveCall } from './callActions';
import { toggleCallCamera, toggleCallMic, useCallSession } from './callSessionController';
import { setCallMinimized } from './callUiStore';

/**
 * Drives the host's ongoing-call notification (`videoCalls.
 * ongoingCallNotification`, an Android foreground-service notification in
 * the Ethora app): shown while a call is connecting or connected, updated
 * when the mic, camera or timer anchor change, and its buttons act on the
 * call like the in-app ones.
 */
export const useOngoingCallNotification = (
  adapter: OngoingCallNotification | undefined
): void => {
  const t = useT();
  const call = useSelector((state: RootState) => state.call);
  const session = useCallSession();
  const shownRef = useRef(false);

  const live =
    !!call.token && (call.phase === 'connecting' || call.phase === 'in-call');

  useEffect(() => {
    if (!adapter) {return;}
    return adapter.addActionListener((action: OngoingCallNotificationAction) => {
      switch (action) {
        case 'hangUp':
          terminateActiveCall('ended');
          break;
        case 'toggleMic':
          void toggleCallMic();
          break;
        case 'toggleCamera':
          void toggleCallCamera();
          break;
        case 'open':
          // Back from the notification: show the call, not the strip.
          setCallMinimized(false);
          break;
      }
    });
  }, [adapter]);

  const isVideo = call.kind === 'video';
  const connectedAt = session.anchorAt;
  const text =
    connectedAt !== null
      ? isVideo
        ? t('call.notification.ongoingVideo')
        : t('call.notification.ongoing')
      : !session.connected
        ? t('call.status.connecting')
        : t('call.status.waitingForPeer');

  useEffect(() => {
    if (!adapter) {return;}
    if (!live) {
      if (shownRef.current) {
        shownRef.current = false;
        adapter.hide();
      }
      return;
    }
    shownRef.current = true;
    adapter.show({
      callId: call.callId || call.roomJid || 'call',
      title: call.roomName || t('call.unknownCaller'),
      text,
      kind: call.kind,
      connectedAt,
      micOn: session.micOn,
      cameraOn: isVideo && session.cameraOn,
      labels: {
        hangUp: t('call.action.hangUp'),
        mute: t('call.notification.mute'),
        unmute: t('call.notification.unmute'),
        cameraOn: t('call.notification.cameraOn'),
        cameraOff: t('call.notification.cameraOff'),
      },
    });
  }, [
    adapter,
    live,
    t,
    text,
    connectedAt,
    isVideo,
    call.callId,
    call.roomJid,
    call.roomName,
    call.kind,
    session.micOn,
    session.cameraOn,
  ]);

  useEffect(
    () => () => {
      if (adapter && shownRef.current) {
        shownRef.current = false;
        adapter.hide();
      }
    },
    [adapter]
  );
};
