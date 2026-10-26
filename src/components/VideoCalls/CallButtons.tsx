import React, { FC, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../roomStore';
import { setCallError, startOutgoingCall } from '../../roomStore/callSlice';
import { sendCallInviteSignal } from '../../networking/callTokenStanza';
import { requestOutgoingCall } from '../../calls/startCall';
import { isCallRoomTypeAllowed } from '../../calls/callMode';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { AudioCallIcon, VideoCallIcon } from './CallIcons';
import { useT } from '../../i18n/useT';
import { getIconColor } from '../../helpers/getIconColor';

/**
 * The audio / video call entry points for the chat header.
 *
 * Kept as its own component (rather than inlined into ChatHeader like the
 * web SDK does) so the whole call feature stays inside components/VideoCalls
 * and ChatHeader gains exactly one line. It renders nothing at all when
 * calls are off, which is the common case.
 *
 * Gating mirrors the web rules: calls need `config.videoCalls.enabled`, a
 * `livekitUrl`, a 1:1 (private) or members-only group room (subject to
 * `allowedRoomTypes`, default both), and no other call already running.
 * Audio is a second opt-in on top of that (`enableAudioCalls`).
 */
export const CallButtons: FC = () => {
  const dispatch = useDispatch();
  const t = useT();
  const { config, user } = useChatSettingState();
  const call = useSelector((state: RootState) => state.call);
  const currentRoom = useSelector((state: RootState) => {
    const jid = state.rooms.activeRoomJID;
    return jid ? state.rooms.rooms[jid] : null;
  });

  const videoCallsConfig = config?.videoCalls;
  const isVideoCallsEnabled = videoCallsConfig?.enabled === true;
  const isGroupRoom = currentRoom?.type === 'group';
  // 1:1 chats and members-only group chats can call, subject to the host's
  // videoCalls.allowedRoomTypes (default: both). Public rooms never do.
  const isRoomAllowed = isCallRoomTypeAllowed(
    currentRoom?.type,
    videoCallsConfig?.allowedRoomTypes
  );
  const hasLivekitUrl = Boolean(videoCallsConfig?.livekitUrl?.trim());
  const isCallBusy = call.phase !== 'idle';
  const canCall = isVideoCallsEnabled && isRoomAllowed && hasLivekitUrl;
  const isAudioCallsEnabled =
    canCall && videoCallsConfig?.enableAudioCalls === true;

  const iconColor = getIconColor(config);

  const placeCall = useCallback(
    async (kind: 'audio' | 'video') => {
      if (!canCall || isCallBusy || !currentRoom?.jid) {
        return;
      }

      // The call API expects the bare room name (e.g. "${appId}_<uuid>"),
      // which createRoomFromApi stores as the JID localpart.
      // `currentRoom.name` looks tempting but actually holds the display
      // title (the other party's "First Last"), so passing it produces
      // nonsense URLs like /v1/chats/call/create/test2%20test2.
      const chatName = currentRoom.jid.split('@')[0];
      if (!chatName) {return;}

      // Resolve the peer xmpp localpart so we can XMPP-signal them when we
      // hang up or cancel, without this they'd keep ringing forever. A group
      // call has no single peer to signal; the server rings every member and
      // LiveKit carries the call.
      const selfLocal = String(user?.xmppUsername || '').split('@')[0];
      const peer = isGroupRoom
        ? undefined
        : (currentRoom.members || []).find((member: any) => {
            const mLocal = String(member?.xmppUsername || '').split('@')[0];
            return mLocal && mLocal !== selfLocal;
          });
      const peerXmppUsername = peer?.xmppUsername || null;

      // Don't show "deleted" / "Deleted User" / "Unknown" as the dial
      // screen title when the chat title is one of the server sentinels.
      // Prefer the peer's first+last name, falling back to the bare chat name.
      // `title` is what the header shows ("John Pauliller"); on new-arch
      // private rooms `name` is the bare room id.
      const rawTitle = String(
        (currentRoom as any).title || currentRoom.name || ''
      ).trim();
      const isBadTitle =
        !rawTitle ||
        ['deleted', 'deleted user', 'unknown', 'null'].includes(
          rawTitle.toLowerCase()
        );
      const peerDisplay = peer
        ? `${peer.firstName || ''} ${peer.lastName || ''}`.trim() ||
          (peer as any).name ||
          ''
        : '';
      const dialName =
        (isBadTitle ? peerDisplay : rawTitle) || peerDisplay || chatName;

      dispatch(
        startOutgoingCall({
          roomJid: currentRoom.jid,
          roomName: dialName,
          roomBareName: chatName,
          kind,
          peerXmppUsername,
          isGroup: isGroupRoom,
        })
      );

      // Server's broadcast call-token currently drops the `kind` attribute,
      // so signal it directly to the peer first. Direct chat is fast
      // (~50ms) and almost always lands before the server-relayed token
      // (~200-300ms), so the callee enters the right UI mode.
      if (peerXmppUsername) {
        sendCallInviteSignal(kind, {
          peerXmppUsername,
          roomBareName: chatName,
        });
      }

      try {
        await requestOutgoingCall({ chatName, kind, peerXmppUsername });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('call.error.connectFailed');
        dispatch(setCallError(message));
      }
    },
    [canCall, isCallBusy, currentRoom, isGroupRoom, user?.xmppUsername, dispatch, t]
  );

  if (!canCall || isCallBusy) {
    return null;
  }

  return (
    <View style={styles.row}>
      {isAudioCallsEnabled && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t('call.action.startAudioCall')}
          onPress={() => {
            void placeCall('audio');
          }}
          style={styles.button}
          hitSlop={8}
        >
          <AudioCallIcon color={iconColor} size={22} />
        </TouchableOpacity>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={t('call.action.startVideoCall')}
        onPress={() => {
          void placeCall('video');
        }}
        style={styles.button}
        hitSlop={8}
      >
        <VideoCallIcon color={iconColor} size={22} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default CallButtons;
