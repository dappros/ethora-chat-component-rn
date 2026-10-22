/** @format */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  LayoutChangeEvent,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  type GestureType,
} from 'react-native-gesture-handler';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useDispatch } from 'react-redux';
import type { ModalFile } from '../../../types/types';
import {
  BackIcon,
  DeleteIcon,
  PauseIcon,
  PlayIcon,
  ReplyIcon,
  SaveIcon,
} from '../../../assets/icons';
import { withFileToken } from '../../../helpers/secureFileUrl';
import {
  downloadVideoToCache,
  findCachedVideo,
  isRemoteUrl,
  isStreamingUnsupported,
  markStreamingUnsupported,
} from '../../../helpers/videoCache';
import { setDeleteModal } from '../../../roomStore/chatSettingsSlice';
import { setActiveMessage, setEditAction } from '../../../roomStore/roomsSlice';
import { useT, useUiLocale } from '../../../i18n/useT';

const WHITE = '#FFFFFF';
const BAR_BACKGROUND = 'rgba(0, 0, 0, 0.45)';
/** Drag (fraction of the height) or fling speed that closes the viewer. */
const CLOSE_DISTANCE = 0.15;
const CLOSE_VELOCITY = 900;
/** Swipe (fraction of the width) or fling speed that turns the page. */
const PAGE_DISTANCE = 0.25;
const PAGE_VELOCITY = 700;
/** A playing video takes the chrome away after this long without a touch. */
const AUTO_HIDE_MS = 3000;

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

interface MediaViewerProps {
  /** A picture or a video. */
  file: ModalFile;
  /** Called once the viewer has animated out. */
  onClose: () => void;
  /** Turn to another file of the album (an index into `file.siblings`). */
  onPage?: (index: number) => void;
  onSave: () => void;
  /** After Reply opened the thread, for a host that has more to close. */
  onReplyOpened?: () => void;
}

/**
 * Full-screen photo / video viewer that behaves like Telegram's. A tap shows
 * or hides everything but the media (a fade both ways); a drag up or down
 * pulls the media off with the backdrop fading behind it, and a long enough
 * drag or a fling closes the viewer; a sideways swipe turns the page in an
 * album. The bottom bar carries Reply (where replies are on) and Delete (on
 * one's own message). A video has its own controls in the chrome: tapping
 * them works the player instead of hiding the chrome, and while it plays the
 * chrome goes away by itself after a few seconds.
 */
const MediaViewer: React.FC<MediaViewerProps> = ({
  file,
  onClose,
  onPage,
  onSave,
  onReplyOpened,
}) => {
  const t = useT();
  const locale = useUiLocale();
  const dispatch = useDispatch();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  const appear = useRef(new Animated.Value(0)).current;
  const dragX = useRef(new Animated.Value(0)).current;
  const dragY = useRef(new Animated.Value(0)).current;
  const chrome = useRef(new Animated.Value(1)).current;
  const [chromeVisible, setChromeVisible] = useState(true);
  const [bottomBarHeight, setBottomBarHeight] = useState(0);

  const closing = useRef(false);
  const axis = useRef<'x' | 'y' | null>(null);
  const pendingSlide = useRef<number>(0);
  const playing = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const siblings = file.siblings ?? [];
  const index = file.index ?? 0;
  const hasPrev = siblings.length > 1 && index > 0;
  const hasNext = siblings.length > 1 && index < siblings.length - 1;
  const isVideo = (file.mimetype || '').startsWith('video/');
  const source = file.source;
  const canReply = !!source?.replyTo;
  const canDelete = !!source?.own;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [appear]);

  // ---- chrome ------------------------------------------------------------

  const cancelAutoHide = useCallback(() => {
    if (hideTimer.current) {clearTimeout(hideTimer.current);}
    hideTimer.current = null;
  }, []);

  const showChrome = useCallback(
    (visible: boolean) => {
      setChromeVisible(visible);
      Animated.timing(chrome, {
        toValue: visible ? 1 : 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    },
    [chrome]
  );

  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    if (!playing.current) {return;}
    hideTimer.current = setTimeout(() => showChrome(false), AUTO_HIDE_MS);
  }, [cancelAutoHide, showChrome]);

  useEffect(() => cancelAutoHide, [cancelAutoHide]);

  const toggleChrome = () => {
    const next = !chromeVisible;
    showChrome(next);
    if (next) {scheduleAutoHide();} else {cancelAutoHide();}
  };

  const handlePlayback = useCallback(
    (isPlaying: boolean) => {
      playing.current = isPlaying;
      if (isPlaying) {scheduleAutoHide();} else {cancelAutoHide();}
    },
    [cancelAutoHide, scheduleAutoHide]
  );

  // ---- close / page --------------------------------------------------------

  const close = useCallback(
    (direction = 0) => {
      if (closing.current) {return;}
      closing.current = true;
      cancelAutoHide();
      const animations = [
        Animated.timing(appear, { toValue: 0, duration: 200, useNativeDriver: true }),
      ];
      if (direction !== 0) {
        animations.push(
          Animated.timing(dragY, {
            toValue: direction * height,
            duration: 200,
            useNativeDriver: true,
          })
        );
      }
      Animated.parallel(animations).start(() => onClose());
    },
    [appear, cancelAutoHide, dragY, height, onClose]
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const springBack = (value: Animated.Value) =>
    Animated.spring(value, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 4,
    }).start();

  const turnPage = useCallback(
    (direction: 1 | -1) => {
      Animated.timing(dragX, {
        toValue: -direction * width,
        duration: 160,
        useNativeDriver: true,
      }).start(() => {
        pendingSlide.current = direction;
        onPage?.(index + direction);
      });
    },
    [dragX, index, onPage, width]
  );

  // The new file mounts off-screen on the side it comes from, then slides in.
  useEffect(() => {
    const direction = pendingSlide.current;
    if (!direction) {return;}
    pendingSlide.current = 0;
    playing.current = false;
    dragX.setValue(direction * width);
    Animated.timing(dragX, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [dragX, file.fileURL, width]);

  // ---- gestures ------------------------------------------------------------

  const latest = useRef({ hasPrev, hasNext, width, height, close, turnPage });
  latest.current = { hasPrev, hasNext, width, height, close, turnPage };
  const pageable = siblings.length > 1;

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-12, 12])
        .activeOffsetX(pageable ? [-12, 12] : [-10000, 10000])
        .onStart((e) => {
          axis.current =
            pageable && Math.abs(e.translationX) > Math.abs(e.translationY)
              ? 'x'
              : 'y';
        })
        .onUpdate((e) => {
          const l = latest.current;
          if (axis.current === 'x') {
            // Past the first or last file the page only gives a little.
            const edge =
              (e.translationX > 0 && !l.hasPrev) || (e.translationX < 0 && !l.hasNext);
            dragX.setValue(edge ? e.translationX * 0.3 : e.translationX);
          } else {
            dragY.setValue(e.translationY);
          }
        })
        .onEnd((e) => {
          const l = latest.current;
          if (axis.current === 'x') {
            if ((e.translationX < -l.width * PAGE_DISTANCE || e.velocityX < -PAGE_VELOCITY) && l.hasNext) {
              l.turnPage(1);
            } else if ((e.translationX > l.width * PAGE_DISTANCE || e.velocityX > PAGE_VELOCITY) && l.hasPrev) {
              l.turnPage(-1);
            } else {
              springBack(dragX);
            }
          } else if (
            Math.abs(e.translationY) > l.height * CLOSE_DISTANCE ||
            Math.abs(e.velocityY) > CLOSE_VELOCITY
          ) {
            l.close(Math.sign(e.translationY || e.velocityY) || 1);
          } else {
            springBack(dragY);
          }
          axis.current = null;
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pageable]
  );

  // ---- actions -------------------------------------------------------------

  const handleReply = () => {
    if (!source?.replyTo) {return;}
    const target = source.replyTo;
    close();
    dispatch(setEditAction({ isEdit: false }));
    dispatch(setActiveMessage({ id: target.id, chatJID: target.chatJID }));
    onReplyOpened?.();
  };

  const handleDelete = () => {
    if (!source?.own) {return;}
    const { roomJid, messageId } = source;
    close();
    dispatch(setDeleteModal({ isDeleteModal: true, roomJid, messageId }));
  };

  // ---- styles from the animated values -------------------------------------

  const dragFade = dragY.interpolate({
    inputRange: [-height / 2, 0, height / 2],
    outputRange: [0.15, 1, 0.15],
    extrapolate: 'clamp',
  });
  const dragShrink = dragY.interpolate({
    inputRange: [-height, 0, height],
    outputRange: [0.85, 1, 0.85],
    extrapolate: 'clamp',
  });
  const backdropOpacity = Animated.multiply(appear, dragFade);
  const mediaStyle = {
    transform: [
      { translateX: dragX },
      { translateY: dragY },
      {
        scale: Animated.multiply(
          appear.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }),
          dragShrink
        ),
      },
    ],
    opacity: appear,
  };
  // The chrome steps aside while the media is being dragged.
  const chromeOpacity = Animated.multiply(
    Animated.multiply(chrome, appear),
    dragY.interpolate({
      inputRange: [-60, 0, 60],
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    })
  );
  const chromePointerEvents = chromeVisible ? 'box-none' : 'none';

  const subtitle = [
    source?.timestamp
      ? new Date(source.timestamp).toLocaleString(locale, {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null,
    siblings.length > 1
      ? t('attachment.position', { index: index + 1, total: siblings.length })
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const showBottomBar = canReply || canDelete;

  return (
    <View style={StyleSheet.absoluteFill} testID="media-viewer">
      {/* Light text on the black backdrop; it leaves with the chrome. The
          previous bar style comes back when the viewer unmounts. */}
      <StatusBar barStyle="light-content" hidden={!chromeVisible} animated />
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
      />
      <GestureDetector gesture={pan}>
        <View style={StyleSheet.absoluteFill}>
          <Pressable
            testID="media-viewer-surface"
            style={StyleSheet.absoluteFill}
            onPress={toggleChrome}
          >
            <Animated.View style={[StyleSheet.absoluteFill, mediaStyle]} pointerEvents="none">
              {isVideo ? null : <ViewerImage key={file.fileURL} uri={file.fileURL} />}
            </Animated.View>
          </Pressable>

          {isVideo && (
            <ViewerVideo
              key={file.fileURL}
              uri={withFileToken(file.fileURL)}
              mimetype={file.mimetype}
              mediaStyle={mediaStyle}
              chromeOpacity={chromeOpacity}
              chromePointerEvents={chromePointerEvents}
              bottomOffset={(showBottomBar ? bottomBarHeight : insets.bottom) + 8}
              outerGesture={pan}
              onPlayback={handlePlayback}
              onActivity={scheduleAutoHide}
            />
          )}

          <Animated.View
            pointerEvents={chromePointerEvents}
            style={[styles.topBar, { paddingTop: insets.top + 6, opacity: chromeOpacity }]}
          >
            <TouchableOpacity
              testID="media-viewer-back"
              accessibilityRole="button"
              accessibilityLabel={t('action.close')}
              hitSlop={12}
              style={styles.iconButton}
              onPress={() => close()}
            >
              <BackIcon color={WHITE} />
            </TouchableOpacity>
            <View style={styles.titleBlock}>
              <Text numberOfLines={1} style={styles.title}>
                {source?.senderName || t('modal.filePreview.title')}
              </Text>
              {!!subtitle && (
                <Text numberOfLines={1} style={styles.subtitle}>
                  {subtitle}
                </Text>
              )}
            </View>
            <TouchableOpacity
              testID="media-viewer-save"
              accessibilityRole="button"
              accessibilityLabel={t('action.save')}
              hitSlop={12}
              style={styles.iconButton}
              onPress={onSave}
            >
              <SaveIcon color={WHITE} />
            </TouchableOpacity>
          </Animated.View>

          {showBottomBar && (
            <Animated.View
              pointerEvents={chromePointerEvents}
              onLayout={(e: LayoutChangeEvent) =>
                setBottomBarHeight(e.nativeEvent.layout.height)
              }
              style={[
                styles.bottomBar,
                { paddingBottom: insets.bottom + 8, opacity: chromeOpacity },
              ]}
            >
              {canReply ? (
                <TouchableOpacity
                  testID="media-viewer-reply"
                  accessibilityRole="button"
                  accessibilityLabel={t('action.reply')}
                  hitSlop={12}
                  style={styles.iconButton}
                  onPress={handleReply}
                >
                  <ReplyIcon color={WHITE} />
                </TouchableOpacity>
              ) : (
                <View style={styles.iconButton} />
              )}
              {canDelete && (
                <TouchableOpacity
                  testID="media-viewer-delete"
                  accessibilityRole="button"
                  accessibilityLabel={t('action.delete')}
                  hitSlop={12}
                  style={styles.iconButton}
                  onPress={handleDelete}
                >
                  <DeleteIcon fill={WHITE} />
                </TouchableOpacity>
              )}
            </Animated.View>
          )}
        </View>
      </GestureDetector>
    </View>
  );
};

const ViewerImage: React.FC<{ uri: string }> = ({ uri }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      <Image
        source={{ uri: withFileToken(uri) }}
        style={StyleSheet.absoluteFill}
        resizeMode="contain"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {!loaded && (
        <View style={styles.center}>
          <ActivityIndicator color={WHITE} />
        </View>
      )}
    </>
  );
};

interface ViewerVideoProps {
  uri: string;
  mimetype?: string;
  mediaStyle: any;
  chromeOpacity: Animated.AnimatedInterpolation<number> | Animated.AnimatedMultiplication<number>;
  chromePointerEvents: 'box-none' | 'none';
  /** Distance of the scrubber from the bottom edge (above the action bar). */
  bottomOffset: number;
  /** The viewer's pan, which waits for the scrubber's own drag to fail. */
  outerGesture: GestureType;
  onPlayback: (playing: boolean) => void;
  /** Any touch on the controls: restarts the chrome's auto-hide. */
  onActivity: () => void;
}

/**
 * The video page: the surface in the media layer, the play / pause button
 * and the scrubber in the chrome layer. Streams when the server allows it
 * and falls back to a downloaded copy (AVPlayer refuses servers that ignore
 * byte ranges), which is also what a reopened video plays from.
 */
const ViewerVideo: React.FC<ViewerVideoProps> = ({
  uri,
  mimetype,
  mediaStyle,
  chromeOpacity,
  chromePointerEvents,
  bottomOffset,
  outerGesture,
  onPlayback,
  onActivity,
}) => {
  const t = useT();
  const remote = isRemoteUrl(uri);
  // What the player is given; null until we know where to play from.
  const [source, setSource] = useState<string | null>(remote ? null : uri);
  // null = not downloading, otherwise 0..1 (0 while the size is unknown).
  const [progress, setProgress] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const ended = useRef(false);
  // Opens playing, like Telegram; a pause sticks across a fallback copy.
  const wantsPlay = useRef(true);
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
    p.timeUpdateEventInterval = 0.25;
    if (wantsPlay.current) {p.play();}
  });

  useEffect(() => {
    const subs = [
      player.addListener('playingChange', ({ isPlaying: next }) => {
        setIsPlaying(next);
        onPlayback(next);
      }),
      player.addListener('timeUpdate', ({ currentTime }) => setTime(currentTime)),
      player.addListener('playToEnd', () => {
        ended.current = true;
      }),
      player.addListener('statusChange', (event) => {
        if (event.status === 'readyToPlay') {
          setDuration(player.duration || 0);
          return;
        }
        if (event.status !== 'error') {return;}
        if (source === uri && remote) {
          markStreamingUnsupported(uri);
          download();
        } else {
          setFailed(true);
        }
      }),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, [download, onPlayback, player, remote, source, uri]);

  useEffect(() => () => onPlayback(false), [onPlayback]);

  const togglePlay = () => {
    onActivity();
    if (isPlaying) {
      wantsPlay.current = false;
      player.pause();
      return;
    }
    if (ended.current) {
      ended.current = false;
      player.currentTime = 0;
    }
    wantsPlay.current = true;
    player.play();
  };

  const latest = useRef({ trackWidth, duration, player, onActivity });
  latest.current = { trackWidth, duration, player, onActivity };
  const timeAt = (x: number) => {
    const l = latest.current;
    if (l.trackWidth <= 0 || l.duration <= 0) {return 0;}
    return Math.min(1, Math.max(0, x / l.trackWidth)) * l.duration;
  };
  const seek = (seconds: number) => {
    const l = latest.current;
    ended.current = false;
    l.player.currentTime = seconds;
    setTime(seconds);
    l.onActivity();
  };

  const scrub = useMemo(() => {
    const drag = Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-2, 2])
      .onUpdate((e) => setScrubTime(timeAt(e.x)))
      .onEnd((e) => seek(timeAt(e.x)))
      .onFinalize(() => setScrubTime(null))
      .blocksExternalGesture(outerGesture);
    const tap = Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => seek(timeAt(e.x)))
      .blocksExternalGesture(outerGesture);
    return Gesture.Exclusive(drag, tap);
  }, [outerGesture]);

  const loading = progress !== null || source === null;
  const shown = scrubTime ?? time;
  const fraction = duration > 0 ? Math.min(1, shown / duration) : 0;

  return (
    <>
      <Animated.View
        style={[StyleSheet.absoluteFill, mediaStyle]}
        pointerEvents="none"
      >
        {/* No surface while the copy downloads: the failed stream would
            show the system's "can't play" glyph under the spinner. */}
        {!loading && !failed && (
          <VideoView
            player={player}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
          />
        )}
      </Animated.View>

      {failed ? (
        <View style={styles.center} pointerEvents="none">
          <Text style={styles.failedTitle}>{t('video.cantPlay')}</Text>
          <Text style={styles.failedHint}>{t('video.cantPlayHint')}</Text>
        </View>
      ) : loading ? (
        <View style={styles.center} pointerEvents="none">
          <View style={styles.playButton}>
            <ActivityIndicator color={WHITE} />
          </View>
          {!!progress && (
            <Text style={styles.progress}>{Math.round(progress * 100)}%</Text>
          )}
        </View>
      ) : (
        <>
          <Animated.View
            pointerEvents={chromePointerEvents}
            style={[styles.center, { opacity: chromeOpacity }]}
          >
            <TouchableOpacity
              testID="media-viewer-play"
              accessibilityRole="button"
              activeOpacity={0.8}
              style={styles.playButton}
              onPress={togglePlay}
            >
              {isPlaying ? (
                <PauseIcon width={30} height={30} color={WHITE} />
              ) : (
                <PlayIcon width={30} height={30} color={WHITE} />
              )}
            </TouchableOpacity>
          </Animated.View>

          <Animated.View
            pointerEvents={chromePointerEvents}
            style={[styles.scrubberRow, { bottom: bottomOffset, opacity: chromeOpacity }]}
          >
            <Text style={styles.time}>{formatTime(shown)}</Text>
            <GestureDetector gesture={scrub}>
              <View
                testID="media-viewer-scrubber"
                style={styles.track}
                onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
              >
                <View style={styles.trackLine}>
                  <View style={[styles.trackFill, { width: `${fraction * 100}%` }]} />
                </View>
                <View style={[styles.thumb, { left: fraction * trackWidth - 7 }]} />
              </View>
            </GestureDetector>
            <Text style={styles.time}>{formatTime(duration)}</Text>
          </Animated.View>
        </>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: '#000000',
  },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 10,
    backgroundColor: BAR_BACKGROUND,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 10,
    backgroundColor: BAR_BACKGROUND,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  title: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    marginTop: 2,
  },
  playButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: {
    marginTop: 10,
    color: WHITE,
    fontSize: 13,
    fontWeight: '600',
  },
  failedTitle: {
    color: WHITE,
    fontSize: 16,
    fontWeight: '600',
  },
  failedHint: {
    marginTop: 8,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  scrubberRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  time: {
    color: WHITE,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 36,
    textAlign: 'center',
  },
  track: {
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  trackLine: {
    height: 3,
    borderRadius: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: WHITE,
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: WHITE,
  },
});

export default MediaViewer;
