/** @format */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  MessageInputContainer,
  InputContainer,
  MessageInput,
} from './StyledInputComponents/StyledInputComponents';
import { IConfig, MediaFile } from '../../types/types';
import Button from './Button';
import { SendIcon, AttachIcon, RecordIcon } from '../../assets/icons';
import { KeyboardAvoidingView, Platform, View, Text, TouchableOpacity, Alert, Linking } from 'react-native';
import AttachSheet from '../Modals/AttachSheet/AttachSheet';
import { MediaFilePreview } from './MediaFilePreview';
import { getIconColor } from '../../helpers/getIconColor';
import { getElementFont } from '../../helpers/getElementFont';
import { useT } from '../../i18n/useT';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
// expo-audio replaces the discontinued expo-av: `useAudioRecorder` owns a
// single reusable recorder for this input's lifetime (prepare → record →
// stop → prepare again), and the module-level helpers cover permissions
// and the iOS audio session.
import {
  useAudioRecorder,
  setAudioModeAsync,
  requestRecordingPermissionsAsync,
  RecordingPresets,
} from 'expo-audio';

// iOS photos default to HEIC; many web backends (incl. ours) 500 on
// HEIC uploads because they can't decode it. Convert to JPEG before
// upload — JPEG is universally supported. JPEGs pass through.
// Server rejects uploads over its body-size cap with HTTP 413 (Request
// Entity Too Large). Guard client-side so the user gets a clear message
// instead of a silent failed bubble. 50 MB matches the backend limit.
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${bytes} B`;
};

const normalizeImageAsset = async (asset: ImagePicker.ImagePickerAsset) => {
  const mime = (asset.mimeType || '').toLowerCase();
  const looksLikeHeic =
    mime.includes('heic') ||
    mime.includes('heif') ||
    asset.uri.toLowerCase().endsWith('.heic') ||
    asset.uri.toLowerCase().endsWith('.heif');
  if (!looksLikeHeic) {
    return {
      uri: asset.uri,
      mime: asset.mimeType || 'image/jpeg',
      name: asset.fileName || asset.uri.split('/').pop() || `image_${Date.now()}.jpg`,
    };
  }
  const result = await ImageManipulator.manipulateAsync(asset.uri, [], {
    compress: 0.9,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const baseName = (asset.fileName || asset.uri.split('/').pop() || `image_${Date.now()}`)
    .replace(/\.(heic|heif)$/i, '.jpg');
  return { uri: result.uri, mime: 'image/jpeg', name: baseName };
};

interface SendInputProps {
  sendMessage: (message: string) => void;
  isLoading: boolean;
  editMessage?: string;
  sendMedia: (data: any, type: string) => void;
  config?: IConfig;
  onFocus?: () => void;
  onBlur?: () => void;
  isMessageProcessing?: boolean;
  formatMessage?: (text: string) => string;
  multiline?: boolean;
  inputHeight?: number;
  showPreview?: boolean;
  previewParser?: (text: string) => (string | JSX.Element)[];
}

const SendInput: React.FC<SendInputProps> = ({
  sendMessage,
  sendMedia,
  config,
  onFocus,
  onBlur,
  editMessage,
  isLoading,
  isMessageProcessing,
}) => {
  const t = useT();
  const [message, setMessage] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  // Live counter (seconds) for the recording overlay. Updated by a
  // 250ms interval started in `startRecording`.
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [filePreviews, setFilePreviews] = useState<MediaFile[]>([]);
  const [showMediaMenu, setShowMediaMenu] = useState(false);

  // expo-audio's recorder is a long-lived native object owned by the hook
  // (released automatically on unmount) and reused across recordings, so
  // unlike expo-av's one-shot `Audio.Recording` there is no per-recording
  // instance to hold. The hook has to run unconditionally, but the
  // constructor is inert on both platforms — iOS allocates a bare
  // AVAudioRecorder (no file), Android leaves its MediaRecorder null.
  // Nothing claims the mic, writes a file, or switches the iOS session to
  // playAndRecord until `prepareToRecordAsync`, so consumers with
  // `enableAudio` off carry an idle object and nothing more.
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Tracks whether a recording is actually in flight, so cancel/stop and
  // the unmount teardown can tell "never started" from "needs stopping"
  // without reading native state.
  const isRecordingRef = useRef(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs shadow `message` and `filePreviews` so handleSendClick can:
  //   (a) read the LATEST typed value even when React state hasn't
  //       flushed yet (rapid tap-burst race),
  //   (b) clear the ref SYNCHRONOUSLY before any await — so a follow-up
  //       tap on send that happens before the next render reads `''`
  //       and bails out (instead of re-sending the same content).
  // Without these, fast spam-typing+sending used to collapse 10 user
  // sends into 1 server message with all 10 contents stacked.
  const messageRef = useRef(message);
  const filePreviewsRef = useRef<MediaFile[]>(filePreviews);
  // Guard flag so a 2nd tap during the first send's await is a no-op
  // (versus duplicating the send with stale closure state).
  const sendingRef = useRef(false);

  // Re-entry guard for the document picker. expo-document-picker keeps a
  // single native `pickingContext`; invoking getDocumentAsync again while a
  // pick is still in flight throws "Different document picking in progress"
  // (iOS, bug #4). A double-fire happens on a fast double-tap of the
  // "Document" row or a dev-mode double-run of the sheet's close callback.
  const pickingDocRef = useRef(false);

  const handleFileSelect = (files: MediaFile[]) => {
    // Enforce the upload size cap before anything reaches the network.
    // The backend rejects oversized bodies with HTTP 413; catching it
    // here gives a clear message instead of a silent failed bubble.
    const oversize = files.find(
      (f) => typeof f.size === 'number' && f.size > MAX_MEDIA_BYTES
    );
    if (oversize) {
      Alert.alert(
        'File too large',
        `"${oversize.name}" is ${formatBytes(oversize.size!)}. The maximum allowed size is ${Math.round(
          MAX_MEDIA_BYTES / (1024 * 1024)
        )} MB.`
      );
      return;
    }
    filePreviewsRef.current = files;
    setFilePreviews([...files]);
  };

  // Both pickers use expo-image-picker / expo-document-picker. They
  // own permission prompts internally and surface a `canceled` flag in
  // the result — no need for a separate permissions library or hand-
  // rolled check/request flow.

  const promptOpenSettings = (message: string) => {
    Alert.alert('Permission required', message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  };

  const handleCameraSelection = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      promptOpenSettings('Camera permission is needed to take photos and videos.');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.9,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      if (asset.type === 'video') {
        handleFileSelect([
          {
            uri: asset.uri,
            type: asset.mimeType || 'video/mp4',
            name: asset.fileName || asset.uri.split('/').pop() || `camera_${Date.now()}.mp4`,
            size: (asset as any).fileSize,
          },
        ]);
        return;
      }
      const normalized = await normalizeImageAsset(asset);
      handleFileSelect([
        {
          uri: normalized.uri,
          type: normalized.mime,
          name: normalized.name,
          size: (asset as any).fileSize,
        },
      ]);
    } catch (error) {
      console.error('Camera error:', error);
    }
  };

  const handleGallerySelection = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      promptOpenSettings('Gallery permission is needed to select photos and videos.');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.9,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      // Videos pass through unchanged; only images get the HEIC→JPEG
      // normalization (manipulator is image-only).
      if (asset.type === 'video') {
        handleFileSelect([
          {
            uri: asset.uri,
            type: asset.mimeType || 'video/mp4',
            name: asset.fileName || asset.uri.split('/').pop() || `gallery_${Date.now()}.mp4`,
            size: (asset as any).fileSize,
          },
        ]);
        return;
      }
      const normalized = await normalizeImageAsset(asset);
      handleFileSelect([
        {
          uri: normalized.uri,
          type: normalized.mime,
          name: normalized.name,
          size: (asset as any).fileSize,
        },
      ]);
    } catch (error) {
      console.error('Gallery error:', error);
    }
  };

  const handleFileSelection = async () => {
    // Drop overlapping invocations — a second getDocumentAsync while the
    // first is still presented throws PickingInProgressException on iOS.
    if (pickingDocRef.current) {return;}
    pickingDocRef.current = true;
    try {
      // Let the attach-sheet's modal finish its NATIVE dismissal before we
      // present the picker. The sheet fires this handler right after its
      // slide-out animation, but the underlying RN Modal view-controller
      // dismissal is async — presenting the document picker over a still-
      // dismissing modal makes iOS tear it down without a cancel callback,
      // which strands expo-document-picker's pickingContext and makes every
      // subsequent open throw "Different document picking in progress".
      if (Platform.OS === 'ios') {
        await new Promise((resolve) => setTimeout(resolve, 350));
      }
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {return;}
      const asset = result.assets[0];
      handleFileSelect([
        {
          uri: asset.uri,
          type: asset.mimeType || 'application/octet-stream',
          name: asset.name || `file_${Date.now()}`,
          size: asset.size ?? undefined,
        },
      ]);
    } catch (err) {
      console.error('DocumentPicker error:', err);
    } finally {
      pickingDocRef.current = false;
    }
  };

  const handleAttachPress = () => {
    setShowMediaMenu(true);
  };

  // ─── Voice recording ──────────────────────────────────────────────
  //
  // Mirrors the web experience: tap mic → start recording → either tap
  // X to discard, or tap send to stop + immediately upload + post the
  // voice message. Uses expo-audio's AudioRecorder (already a peer dep
  // for AudioMessage playback). Filename is `voice-<timestamp>.m4a` with
  // mimetype `audio/m4a` so the receiver routes through the audio
  // branch in MediaMessage directly, no octet-stream sniffing needed.

  const stopRecordingTimer = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  };

  // Always reset the iOS audio mode after teardown so AudioMessage
  // playback elsewhere in the app isn't routed to the earpiece.
  const restoreAudioMode = async () => {
    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });
    } catch {
      /* non-fatal */
    }
  };

  const handleStartRecording = async () => {
    if (isRecording || isRecordingRef.current) {return;}
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        promptOpenSettings(
          'Microphone permission is needed to record voice messages.'
        );
        return;
      }
      // `allowsRecording` is not just an iOS session flag: expo-audio's
      // recorder throws RecordingDisabledException from record() when the
      // audio mode has it off. Flipped back in restoreAudioMode after
      // stop/cancel so playback elsewhere isn't stuck on the earpiece.
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      // Passing the preset (rather than preparing bare) makes the native
      // side allocate a FRESH output file for this take. Without it the
      // recorder reuses the previous URL, so a second voice message would
      // overwrite the first while its upload is still in flight.
      await audioRecorder.prepareToRecordAsync(RecordingPresets.HIGH_QUALITY);
      audioRecorder.record();
      isRecordingRef.current = true;
      setIsRecording(true);
      setRecordingDuration(0);
      const startedAt = Date.now();
      // 250ms tick is fine for a seconds counter — keeps re-renders cheap.
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startedAt) / 1000));
      }, 250);
    } catch (err) {
      console.warn('startRecording failed', err);
      isRecordingRef.current = false;
      setIsRecording(false);
      setRecordingDuration(0);
      await restoreAudioMode();
    }
  };

  const handleCancelRecording = async () => {
    stopRecordingTimer();
    const wasRecording = isRecordingRef.current;
    isRecordingRef.current = false;
    setIsRecording(false);
    setRecordingDuration(0);
    if (wasRecording) {
      try {
        await audioRecorder.stop();
      } catch {
        /* already stopped — fine */
      }
    }
    await restoreAudioMode();
  };

  const handleStopAndSendRecording = async () => {
    stopRecordingTimer();
    const wasRecording = isRecordingRef.current;
    isRecordingRef.current = false;
    setIsRecording(false);
    const seconds = recordingDuration;
    setRecordingDuration(0);
    if (!wasRecording) {
      await restoreAudioMode();
      return;
    }
    // Guard against zero-length taps — if the user tapped mic + send
    // within the same tick there's nothing audible to send.
    if (seconds < 1) {
      try {
        await audioRecorder.stop();
      } catch {}
      await restoreAudioMode();
      return;
    }
    try {
      await audioRecorder.stop();
    } catch (err) {
      console.warn('recorder.stop failed', err);
    }
    // Read the URI while it still points at THIS take — the next
    // prepareToRecordAsync() swaps in a new output file.
    const uri = audioRecorder.uri;
    await restoreAudioMode();
    if (!uri) {return;}
    // HIGH_QUALITY preset writes AAC in an M4A container on both iOS
    // and Android, so a single mimetype works. `voice-<ts>.m4a`
    // matches the receiver's audio branch in MediaMessage (and
    // isLikelyAudio for any backend that strips mimetype).
    const ts = Date.now();
    const file: MediaFile = {
      uri,
      type: 'audio/m4a',
      name: `voice-${ts}.m4a`,
    };
    try {
      await sendMedia(file, file.type);
    } catch (err) {
      console.error('sendMedia voice failed', err);
    }
  };

  // Tear down a recording in progress when the input unmounts (chat
  // close, navigation, etc.) so the mic isn't left hot.
  useEffect(() => {
    return () => {
      stopRecordingTimer();
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        audioRecorder.stop().catch(() => {});
      }
      restoreAudioMode();
    };
    // The hook's recorder identity is stable (its options never change),
    // so this teardown runs on unmount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioRecorder]);

  const handleRemoveImage = (index: number) => {
    const next = filePreviewsRef.current.filter((_, i) => i !== index);
    filePreviewsRef.current = next;
    setFilePreviews(next);
  };

  const handleSendClick = useCallback(async () => {
    // Snapshot LATEST values from refs, not from the React-state
    // closure. The closure is captured at render-time and may be
    // stale by the time a fast-fingered user spams the send button.
    const messageToSend = messageRef.current;
    const filesToSend = filePreviewsRef.current;

    // Nothing to send → bail. Critical for the spam case: after the
    // first tap clears refs, subsequent taps queued by RN's native
    // gesture system see empty refs and exit without re-sending.
    if (!messageToSend && filesToSend.length === 0) {return;}

    // Re-entrancy guard. If a previous send is still awaiting upload
    // / xmpp.send, a second tap should NOT slip through with the
    // same snapshotted content.
    if (sendingRef.current) {return;}
    sendingRef.current = true;

    // CLEAR EVERYTHING SYNCHRONOUSLY — refs first (so the early-bail
    // above catches the next rapid tap immediately), then dispatch
    // state updates so the UI catches up on the next render.
    messageRef.current = '';
    filePreviewsRef.current = [];
    setMessage('');
    setFilePreviews([]);

    try {
      for (const file of filesToSend) {
        try {
          await sendMedia(file, file.type);
        } catch (err) {
          console.error(err);
          return;
        }
      }
      if (messageToSend) {
        sendMessage(messageToSend);
      }
    } finally {
      sendingRef.current = false;
    }
    // Deps intentionally exclude `message` / `filePreviews` — we read
    // from refs, so closure freshness is irrelevant and re-creating
    // the handler on every keystroke would just thrash GC + risk the
    // (still-async) `disabled` button race.
  }, [sendMessage, sendMedia]);

  useEffect(() => {
    const next = editMessage || '';
    messageRef.current = next;
    setMessage(next);
  }, [editMessage]);

  // iOS's multiline TextInput always top-aligns its content (UITextView
  // has no vertical-centering API RN can hook into — `textAlignVertical`
  // is Android-only), so a `minHeight` taller than one text line leaves
  // the placeholder/cursor pinned near the top instead of centered. Fix:
  // derive vertical padding from the actual line height so the box's
  // resting height already equals its content height — nothing is left
  // to look top-aligned.
  const inputFontSize =
    config?.typography?.input?.fontSize ??
    config?.typography?.elements?.inputText?.fontSize ??
    16;
  const inputMinHeight = config?.typography?.input?.minHeight ?? 40;
  const estimatedLineHeight = inputFontSize * 1.2;
  const inputVerticalPadding = Math.max(
    4,
    (inputMinHeight - estimatedLineHeight) / 2
  );

  return (
    <InputContainer isText={!!message}>
        {filePreviews.length > 0 && (
          <MediaFilePreview
            filePreviews={filePreviews}
            handleRemoveImage={handleRemoveImage}
          />
        )}
        <MessageInputContainer>
          {!isRecording && (
            <>
              {/* Media selection button - always visible on the left, unless disabled in config */}
              {!config?.disableMedia && (
                <TouchableOpacity
                  onPress={handleAttachPress}
                  style={{
                    width: 40,
                    height: 40,
                    justifyContent: 'center',
                    alignItems: 'center',
                    backgroundColor: 'transparent',
                  }}
                  activeOpacity={0.7}
                >
                  <AttachIcon color={getIconColor(config)} />
                </TouchableOpacity>
              )}
              <MessageInput
                testID="chat-message-input"
                accessibilityLabel="chat-message-input"
                isFocused={isFocused}
                color={config?.colors?.primary}
                fontSize={config?.typography?.input?.fontSize}
                fontWeight={config?.typography?.input?.fontWeight as any}
                placeholder={t('input.placeholder')}
                placeholderTextColor="#999"
                value={message}
                onChangeText={(text) => {
                  messageRef.current = text;
                  setMessage(text);
                }}
                onFocus={() => {
                  onFocus?.();
                  setIsFocused(true);
                }}
                onBlur={() => {
                  onBlur?.();
                  setIsFocused(false);
                }}
                editable={!isLoading || !isMessageProcessing}
                multiline={true}
                // No fixed height: a multiline TextInput auto-grows to fit
                // its content between min/max. Locking `height` made iOS
                // top-align the text inside the taller box (it looked like
                // the text had dropped). paddingVertical (computed above)
                // makes the resting box height equal minHeight without
                // leaving slack above the text, which is what actually
                // centers it on iOS.
                style={[
                  {
                    minHeight: inputMinHeight,
                    maxHeight: config?.typography?.input?.maxHeight ?? 120,
                    paddingTop: inputVerticalPadding,
                    paddingBottom: inputVerticalPadding,
                    flex: 1,
                  },
                  getElementFont(config, 'inputText'),
                ]}
              />
            </>
          )}
          {isRecording && (
            <>
              <TouchableOpacity
                testID="chat-record-cancel"
                accessibilityLabel="chat-record-cancel"
                onPress={handleCancelRecording}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#FEE2E2',
                }}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#B91C1C', fontWeight: '700', fontSize: 18 }}>×</Text>
              </TouchableOpacity>
              {/* Live elapsed time + red recording dot. flex:1 so it
                * occupies the middle slot the input used to have. */}
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  paddingHorizontal: 8,
                  minHeight: 40,
                }}
              >
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: '#EF4444',
                  }}
                />
                <Text style={{ fontSize: 16, color: '#1F2937', fontWeight: '500' }}>
                  {Math.floor(recordingDuration / 60)}:
                  {(recordingDuration % 60).toString().padStart(2, '0')}
                </Text>
                <Text style={{ fontSize: 13, color: '#6B7280' }}>Recording…</Text>
              </View>
            </>
          )}
          {/* Right-side action button — swaps based on context:
            *   • while recording: stop-and-send (red dot in overlay
            *     is the live indicator; this is the same primary
            *     button so a single tap stops + ships).
            *   • idle + nothing typed + voice enabled: MIC (tap →
            *     start recording).
            *   • idle + has text / attachments: SEND.
            *   • idle + nothing typed + voice disabled: SEND in its
            *     muted/disabled state (so the slot reserved for
            *     consistency).
            * Matches the web UX where one button on the right swaps
            * between mic and send based on whether you have content. */}
          {(() => {
            const hasContent = !!message || filePreviews.length > 0;
            const showMic = !isRecording && !hasContent && !!config?.enableAudio;
            const onPress = isRecording
              ? handleStopAndSendRecording
              : showMic
                ? handleStartRecording
                : handleSendClick;
            const disabled = !isRecording && !showMic && !hasContent;
            const filled = isRecording || hasContent || showMic;
            return (
              <Button
                testID={showMic ? 'chat-record-button' : 'chat-send-button'}
                accessibilityLabel={showMic ? 'chat-record-button' : 'chat-send-button'}
                onPress={onPress}
                disabled={disabled}
                EndIcon={
                  showMic ? (
                    <RecordIcon color="#FFFFFF" />
                  ) : (
                    <SendIcon color={filled ? '#FFFFFF' : '#D4D4D8'} />
                  )
                }
                style={{
                  width: config?.typography?.input?.sendButtonSize ?? 40,
                  height: config?.typography?.input?.sendButtonSize ?? 40,
                  borderRadius: 50,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginLeft: 0,
                  marginRight: 0,
                  backgroundColor: filled
                    ? getIconColor(config)
                    : 'transparent',
                  opacity: filled ? 1 : 0.5,
                }}
              />
            );
          })()}
        </MessageInputContainer>
        <AttachSheet
          visible={showMediaMenu}
          onClose={() => setShowMediaMenu(false)}
          onCamera={handleCameraSelection}
          onGallery={handleGallerySelection}
          onDocument={handleFileSelection}
          primaryColor={getIconColor(config)}
        />
      </InputContainer>
  );
};

export default SendInput;
