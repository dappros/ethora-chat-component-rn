import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withFileToken } from '../../../helpers/secureFileUrl';
import styled from 'styled-components/native';
import {
  CenterContainer,
  ModalContainerFullScreen,
} from '../styledModalComponents';
import { SaveIcon } from '../../../assets/icons';
import ModalHeaderComponent from '../ModalHeaderComponent';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { useTheme } from '../../../hooks/useTheme';
import { chatTextStyle } from '../../../helpers/typography';
import { useDispatch, useSelector, useStore } from 'react-redux';
import Button from '../../styled/Button';
import { RootState } from '../../../roomStore';
import { FullScreenImage } from '../../styled/StyledInputComponents/MediaComponents';
import { setActiveFile } from '../../../roomStore/chatSettingsSlice';
import type { ModalFile } from '../../../types/types';
import MediaViewer from './MediaViewer';
import { isLocalFile, useSaveFile } from './useSaveFile';
import { withChatSiblings } from '../../../helpers/roomMedia';
import { loadRoomHistory } from '../../../helpers/loadRoomHistory';
import { getGlobalXmppClient } from '../../../utils/clientRegistry';
import { useFileToken } from '../../../hooks/useFileToken';
import {
  ActivityIndicator,
  Text,
  View,
  Platform,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { PlayIcon } from '../../../assets/icons';
import { useT } from '../../../i18n/useT';
import PdfViewer from './PdfView';
import DocumentViewer from './DocumentViewer';
import AudioMessage from '../../styled/AudioMessage';
import { isLikelyAudio } from '../../../helpers/mimeToExtension';
import {
  downloadVideoToCache,
  findCachedVideo,
  isRemoteUrl,
  isStreamingUnsupported,
  markStreamingUnsupported,
} from '../../../helpers/videoCache';
import {
  getDisplayFileName,
  sanitizeFileNameForPath,
} from '../../../helpers/getDisplayFileName';

// MIME types Google's gview embed renders reliably. Everything else
// falls through to the info-card so the user can still download.
const GVIEW_PREVIEWABLE = new Set<string>([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'application/rtf',
]);

const isMedia = (mime: string | undefined | null) =>
  !!mime && (mime.startsWith('image/') || mime.startsWith('video/'));

/** Older history pages the viewer asked for; one at a time per room. */
const historyInFlight = new Set<string>();
const HISTORY_PAGE_SIZE = 30;

const isGviewPreviewable = (mime: string | undefined | null) => {
  if (!mime) {return false;}
  return GVIEW_PREVIEWABLE.has(mime.toLowerCase().split(';')[0]!.trim());
};

// Full-screen video preview on expo-video (the discontinued expo-av
// <Video> rendered blank on Android). `contentFit: contain` fits the clip to
// the area with the surrounding letterbox painted as the view's own
// (transparent → theme) background, NOT black. `textureView` so the play
// overlay composites on top and nothing is clipped on Android.
//
// The clip is streamed when the server allows it. AVPlayer does not play
// from a server that ignores byte-range requests (it answers 200 instead of
// 206 and the player stops with "server is not correctly configured"), so
// a failed stream falls back to a downloaded copy in the cache — which is
// also what a reopened video plays from.
const ModalVideo: React.FC<{ uri: string; mimetype?: string }> = ({
  uri,
  mimetype,
}) => {
  const theme = useTheme();
  const remote = isRemoteUrl(uri);
  // What the player is given; null until we know where to play from.
  const [source, setSource] = useState<string | null>(remote ? null : uri);
  const [showPlay, setShowPlay] = useState(true);
  // null = not downloading, otherwise 0..1 (0 while the size is unknown).
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const wantsPlay = useRef(false);
  const downloadStarted = useRef(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const download = useCallback(() => {
    if (downloadStarted.current) {return;}
    downloadStarted.current = true;
    setProgress(0);
    downloadVideoToCache(uri, mimetype, (fraction) => {
      if (mounted.current) {setProgress(fraction);}
    })
      .then((localUri) => {
        if (!mounted.current) {return;}
        setProgress(null);
        setSource(localUri);
      })
      .catch((err) => {
        console.warn('video download failed', err);
        if (!mounted.current) {return;}
        setProgress(null);
        setFailed(true);
      });
  }, [mimetype, uri]);

  useEffect(() => {
    if (!remote) {return;}
    let active = true;
    findCachedVideo(uri, mimetype).then((cached) => {
      if (!active) {return;}
      if (cached) {
        setSource(cached);
      } else if (isStreamingUnsupported(uri)) {
        download();
      } else {
        setSource(uri);
      }
    });
    return () => {
      active = false;
    };
  }, [download, mimetype, remote, uri]);

  const player = useVideoPlayer(source, (p) => {
    p.muted = false;
    // A player made for the downloaded copy picks up a play the user
    // already asked for.
    if (wantsPlay.current) {p.play();}
  });

  useEffect(() => {
    const playing = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) {setShowPlay(false);}
    });
    const status = player.addListener('statusChange', (event) => {
      if (event.status !== 'error') {return;}
      if (source === uri && remote) {
        markStreamingUnsupported(uri);
        download();
      } else {
        setFailed(true);
      }
    });
    return () => {
      playing.remove();
      status.remove();
    };
  }, [download, player, remote, source, uri]);

  const handlePlay = () => {
    wantsPlay.current = true;
    setShowPlay(false);
    player.play();
  };

  if (failed) {
    return (
      <View style={styles.videoMessage}>
        <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
          This video can't be played
        </Text>
        <Text style={{ color: theme.textSecondary, textAlign: 'center' }}>
          Tap the save icon above to download it.
        </Text>
      </View>
    );
  }

  const loading = progress !== null || source === null;

  return (
    <View style={{ flex: 1, width: '100%' }}>
      {/* No surface while the copy downloads: the failed stream would
          show the system's "can't play" glyph under the spinner. */}
      {!loading && (
        <VideoView
          player={player}
          style={{ flex: 1, backgroundColor: 'transparent' }}
          contentFit="contain"
          nativeControls
          surfaceType="textureView"
          // Fullscreen stays available by default on both expo-video lines:
          // `allowsFullscreen` (SDK 54, default true) was replaced by
          // `fullscreenOptions.enable` (SDK 57, default true). Passing
          // neither keeps this file compiling against both.
        />
      )}
      {loading ? (
        <View style={styles.playOverlay} pointerEvents="none">
          <View style={styles.playButton}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
          {!!progress && (
            <Text style={[styles.progress, { color: theme.textSecondary }]}>
              {Math.round(progress * 100)}%
            </Text>
          )}
        </View>
      ) : (
        showPlay && (
          // Play affordance shown immediately on open; tapping starts
          // playback and the native controls take over.
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={handlePlay}
            style={StyleSheet.absoluteFill}
          >
            <View style={styles.playOverlay}>
              <View style={styles.playButton}>
                <PlayIcon width={28} height={28} />
              </View>
            </View>
          </TouchableOpacity>
        )
      )}
    </View>
  );
};

interface FilePreviewModalProps {
  handleCloseModal: any;
}

/** The viewer on the store's `activeFile`, as opened from a message bubble. */
const FilePreviewModal: React.FC<FilePreviewModalProps> = ({
  handleCloseModal,
}) => {
  const dispatch = useDispatch();
  const store = useStore<RootState>();
  const { activeFile } = useSelector(
    (state: RootState) => state.chatSettingStore
  );
  const { user, config } = useChatSettingState();
  const fileToken = useFileToken();
  const roomJid = activeFile?.source?.roomJid;
  const room = useSelector((state: RootState) =>
    roomJid ? state.rooms.rooms?.[roomJid] : undefined
  );
  const messages = room?.messages;

  // A picture or video opened from a bubble pages through the whole chat;
  // anything not in the loaded history keeps what it was opened with.
  const file = useMemo(() => {
    if (!activeFile?.fileURL || !isMedia(activeFile.mimetype)) {return activeFile;}
    return (
      withChatSiblings(activeFile, messages, {
        me: user,
        fileToken,
        interactive: !config?.disableInteractions,
        repliesOn: !config?.disableReplies,
      }) ?? activeFile
    );
  }, [activeFile, messages, user, fileToken, config?.disableInteractions, config?.disableReplies]);

  // On the oldest loaded file, ask for an older page: what it brings in
  // shows up to the left of it.
  const atOldest = !!file?.siblings && file.index === 0 && !!roomJid;
  const historyComplete = !!room?.historyComplete;
  useEffect(() => {
    if (!atOldest || historyComplete || !roomJid) {return;}
    loadRoomHistory({
      client: getGlobalXmppClient(),
      room: store.getState().rooms.rooms?.[roomJid],
      inFlight: historyInFlight,
      chatJID: roomJid,
      max: HISTORY_PAGE_SIZE,
    });
  }, [atOldest, historyComplete, roomJid, store]);

  if (!file?.fileURL) {return null;}

  const closeModal = () => {
    dispatch(
      setActiveFile({
        fileName: '',
        fileURL: '',
        mimetype: '',
      })
    );
    handleCloseModal?.();
  };

  return (
    <FilePreview
      file={file}
      onClose={closeModal}
      onChangeFile={(next) => dispatch(setActiveFile(next))}
    />
  );
};

interface FilePreviewProps {
  file: ModalFile;
  onClose: () => void;
  /** Another file of the album (siblings and index included). */
  onChangeFile: (file: ModalFile) => void;
  /** After the media viewer's Reply opened a thread. */
  onReplyOpened?: () => void;
}

/**
 * One file, full screen: pictures and videos in the Telegram-style
 * MediaViewer, everything else (documents, PDFs, voice notes) on the
 * plain preview page with the save button in its header.
 */
export const FilePreview: React.FC<FilePreviewProps> = ({
  file: activeFile,
  onClose,
  onChangeFile,
  onReplyOpened,
}) => {
  const t = useT();
  const { config } = useChatSettingState();
  const theme = useTheme();
  // Info / audio cards: light keeps its warm tint (not in the palette),
  // dark sits them on the secondary surface.
  const cardBackground = theme.dark ? theme.surfaceSecondary : '#FFF8ED';

  // Bug #40: prefer the sender's original name over the server's stored
  // hash name everywhere this modal shows or saves/shares the file.
  // Sanitized so it's safe to use as an actual path segment (strips path
  // separators/control chars) when writing to disk below.
  const displayFileName = sanitizeFileNameForPath(
    getDisplayFileName({
      originalName: activeFile.originalName,
      fileName: activeFile.fileName,
      location: activeFile.fileURL,
      mimetype: activeFile.mimetype,
    })
  );

  const saveFile = useSaveFile();
  const saveClick = () => saveFile(activeFile);

  // An album opens with its siblings; the viewer pages through them.
  const albumSize = activeFile.siblings?.length ?? 0;
  const albumIndex = activeFile.index ?? 0;
  const goToSibling = (next: number) => {
    const target = activeFile.siblings?.[next];
    if (!target) {return;}
    onChangeFile({ ...target, siblings: activeFile.siblings, index: next });
  };
  const closeModal = onClose;

  if (
    activeFile.mimetype.startsWith('image/') ||
    activeFile.mimetype.startsWith('video/')
  ) {
    return (
      <MediaViewer
        file={activeFile}
        onClose={onClose}
        onPage={goToSibling}
        onSave={saveClick}
        onReplyOpened={onReplyOpened}
      />
    );
  }

  // NOTE: plain computed value, NOT useMemo. It sits AFTER the
  // `if (!activeFile) return` guard above, so as a hook it would run
  // conditionally (skipped when activeFile is null) — changing the hook
  // count between renders and throwing "rendered more hooks than during
  // the previous render", which crashed the modal the instant you tapped
  // a video/image to open it. Recomputing this on each render is cheap.
  const getMediaComponent: React.ReactNode = (() => {
    switch (true) {
      case activeFile.mimetype.startsWith('image/'):
        return (
          <FullScreenImage
            source={{
              uri:
                withFileToken(activeFile.fileURL) ||
                'https://as2.ftcdn.net/v2/jpg/02/51/95/53/1000_F_251955356_FAQH0U1y1TZw3ZcdPGybwUkH90a3VAhb.jpg',
            }}
            resizeMode="contain"
            accessibilityLabel={displayFileName}
          />
        );
      case activeFile.mimetype.startsWith('video/'):
        return (
          <ModalVideo
            // Remount per file: the player state belongs to one clip.
            key={activeFile.fileURL}
            uri={withFileToken(activeFile.fileURL)}
            mimetype={activeFile.mimetype}
          />
        );
      case activeFile.mimetype.includes('application/octet-stream'):
        return (
          <View
            style={{
              width: '100%',
              padding: 20,
              gap: 12,
              backgroundColor: cardBackground,
              borderRadius: 16,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
              Voice message
            </Text>
            <AudioMessage
              src={withFileToken(activeFile.fileURL)}
              mimeType={activeFile.mimetype}
              fileName={activeFile.fileName}
              originalName={activeFile.originalName}
              duration={activeFile.duration}
              waveForm={activeFile.waveForm}
            />
          </View>
        );
      // Mirrors the MediaMessage heuristic: treat octet-stream voicemails
      // with audio-shaped filenames / URLs as audio so the preview shows
      // the player instead of an "Unsupported" card. Customer-reported
      // #9 voicemail fix — see isLikelyAudio in mimeToExtension.ts.
      case isLikelyAudio(
        activeFile.mimetype,
        activeFile.fileName,
        activeFile.fileURL,
        {
          duration: activeFile.duration,
          waveForm: activeFile.waveForm,
          originalName: activeFile.originalName,
        }
      ):
        return (
          <View
            style={{
              width: '100%',
              padding: 20,
              gap: 12,
              backgroundColor: cardBackground,
              borderRadius: 16,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
              {displayFileName}
            </Text>
            <AudioMessage
              src={withFileToken(activeFile.fileURL)}
              mimeType={activeFile.mimetype}
              fileName={activeFile.fileName}
              originalName={activeFile.originalName}
              duration={activeFile.duration}
              waveForm={activeFile.waveForm}
            />
          </View>
        );
      case activeFile.mimetype === 'application/pdf' &&
        !(Platform.OS === 'android' && isLocalFile(activeFile.fileURL)):
        return <PdfViewer pdfUrl={withFileToken(activeFile.fileURL)} />;
      default: {
        // Office docs (.docx / .xlsx / .pptx / .doc / .xls / .ppt /
        // .txt / .csv / .rtf) → render inline via Google's gview embed
        // — fixes the "blank preview" complaint for docs (bug #9).
        if (isGviewPreviewable(activeFile.mimetype) && !isLocalFile(activeFile.fileURL)) {
          return (
            <DocumentViewer
              url={activeFile.fileURL}
              fileName={displayFileName}
            />
          );
        }
        // True last-resort fallback for genuinely unrenderable types
        // (binary blobs, exotic MIMEs). Friendly info card with the
        // filename so the user can still download.
        return (
          <View
            style={{
              backgroundColor: cardBackground,
              borderRadius: 16,
              padding: 20,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }}>
              {displayFileName}
            </Text>
            <Text style={{ color: theme.textSecondary }}>
              {activeFile.mimetype || 'unknown type'}
            </Text>
            <Text style={{ marginTop: 8, color: theme.text }}>
              This file format can't be previewed inline. Tap the save icon
              above to download it.
            </Text>
          </View>
        );
      }
    }
  })();

  return (
    <ModalContainerFullScreen>
      <ModalHeaderComponent
        handleCloseModal={closeModal}
        headerTitle={t('modal.filePreview.title')}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
        rightMenu={
          <>
            <Button onPress={saveClick}>
              <SaveIcon color={theme.textSecondary} />
            </Button>
          </>
        }
      />

      <CenterContainer
        style={{
          display: 'flex',
          flex: 1,
          justifyContent: 'center',
          // NOTE: do NOT set overflow:'hidden' here — on Android it clips
          // hardware-accelerated children (expo-video TextureView and
          // react-native-webview) to nothing, so video/PDF/doc previews
          // render blank while plain <Image> survives.
          overflow: 'visible',
          padding: 16,
          paddingBottom: 48,
        }}
      >
        {getMediaComponent}
      </CenterContainer>

      {albumSize > 1 && (
        <View style={styles.albumNav} testID="file-preview-album-nav">
          <TouchableOpacity
            testID="file-preview-prev"
            accessibilityRole="button"
            accessibilityLabel={t('attachment.previous')}
            disabled={albumIndex <= 0}
            onPress={() => goToSibling(albumIndex - 1)}
            hitSlop={12}
            style={[styles.albumArrow, albumIndex <= 0 && styles.albumArrowOff]}
          >
            <Text style={[styles.albumArrowText, { color: theme.text }]}>{'\u2039'}</Text>
          </TouchableOpacity>
          <Text style={{ color: theme.textSecondary }}>
            {t('attachment.position', { index: albumIndex + 1, total: albumSize })}
          </Text>
          <TouchableOpacity
            testID="file-preview-next"
            accessibilityRole="button"
            accessibilityLabel={t('attachment.next')}
            disabled={albumIndex >= albumSize - 1}
            onPress={() => goToSibling(albumIndex + 1)}
            hitSlop={12}
            style={[
              styles.albumArrow,
              albumIndex >= albumSize - 1 && styles.albumArrowOff,
            ]}
          >
            <Text style={[styles.albumArrowText, { color: theme.text }]}>{'\u203A'}</Text>
          </TouchableOpacity>
        </View>
      )}

    </ModalContainerFullScreen>
  );
};

const styles = StyleSheet.create({
  playOverlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progress: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
  },
  albumNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 24,
  },
  albumArrow: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  albumArrowOff: {
    opacity: 0.3,
  },
  albumArrowText: {
    fontSize: 32,
    lineHeight: 36,
  },
  videoMessage: {
    alignItems: 'center',
    gap: 8,
    padding: 20,
  },
});

export default FilePreviewModal;
