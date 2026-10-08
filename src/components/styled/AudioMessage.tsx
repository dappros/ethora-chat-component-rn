import React, { useEffect, useMemo, useRef, useState } from 'react';
import { withFileToken } from '../../helpers/secureFileUrl';
import {
  View,
  Pressable,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import Svg, { Path, Rect } from 'react-native-svg';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { getIosAudioPlaybackCacheExtension } from '../../helpers/mimeToExtension';
import {
  MIN_BAR,
  formatClipTime,
  parseDurationSeconds,
  parseWaveForm,
  resamplePeaks,
} from '../../helpers/audioWaveform';
import { pushLog as devPushLog } from '../../utils/devLogger';
import { MAX_DECODE_BYTES, decodeAudioClip } from './AudioDecoderHost';

type AudioMessageProps = {
  src: string;
  mimeType?: string;
  fileName?: string;
  originalName?: string;
  /** Seconds, when the sender attached it. */
  duration?: number | string;
  /** Bars the sender attached (see helpers/audioWaveform). */
  waveForm?: string;
  /** Own message: the player takes the bubble's ink instead of the brand. */
  isUser?: boolean;
};

type AudioContainer =
  | 'webm'
  | 'ogg'
  | 'wav'
  | 'mp4'
  | 'mp3'
  | 'aac'
  | 'unknown';

type PreparedSource = {
  localUri: string;
  container: AudioContainer;
  /** The local file is already a natively playable copy (decoded WAV). */
  playable?: boolean;
};

type Analysis = { peaks: number[]; durationMillis: number };

const SPEEDS = [1, 1.5, 2];
const BAR_WIDTH = 3;
const BAR_GAP = 2;
const WAVE_HEIGHT = 24;

/** Waveforms already worked out this session, by source URL. */
const analysisCache = new Map<string, Analysis>();

/**
 * Only one voice note plays at a time, as in the messengers: starting one
 * pauses whichever was playing.
 */
let pauseActive: (() => void) | null = null;

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
};

const withTimeout = async <T,>(
  promise: Promise<T>,
  ms: number,
  label: string
) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label)), ms);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const logAudioDebug = (message: string, details?: Record<string, unknown>) => {
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    devPushLog('rn', message, details);
    console.log(`[AudioDebug] ${message}`, details || {});
  }
};

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Decode just the leading bytes of a base64 string into a byte array. Used
// for magic-number container sniffing — we only need the first ~16 bytes,
// so this avoids pulling a base64 lib in for a handful of bytes.
const decodeBase64Head = (b64: string, maxBytes: number): number[] => {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < b64.length && out.length < maxBytes; i += 1) {
    const ch = b64[i]!;
    if (ch === '=') {
      break;
    }
    const idx = B64_ALPHABET.indexOf(ch);
    if (idx === -1) {
      continue;
    }
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
};

// Sniff the real container from magic bytes. This is the source of truth —
// the HTTP mime is frequently `application/octet-stream` and the filename a
// meaningless `.blob`/`.bin`, so neither can be trusted. Byte signatures:
//   EBML 1A45DFA3 → webm/matroska, OggS → ogg, RIFF…WAVE → wav,
//   ….ftyp → mp4/m4a, ID3 / FFEx → mp3, FFF1/FFF9 → aac(ADTS).
const detectContainer = (bytes: number[]): AudioContainer => {
  if (bytes.length < 4) {
    return 'unknown';
  }
  if (
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) {
    return 'webm';
  }
  if (
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  ) {
    return 'ogg';
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  ) {
    return 'wav';
  }
  if (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return 'mp4';
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    return 'mp3';
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync (mp3) or ADTS AAC — both decode natively.
    return bytes[1] === 0xf1 || bytes[1] === 0xf9 ? 'aac' : 'mp3';
  }
  return 'unknown';
};

const getContainerExtension = (container: AudioContainer) => {
  switch (container) {
    case 'webm':
      return '.webm';
    case 'ogg':
      return '.ogg';
    case 'wav':
      return '.wav';
    case 'mp4':
      return '.m4a';
    case 'mp3':
      return '.mp3';
    case 'aac':
      return '.aac';
    default:
      return '.bin';
  }
};

// AVFoundation (expo-audio) and the iOS WKWebView <audio> element cannot
// demux/decode WebM or Ogg Opus — only `AudioContext.decodeAudioData` can
// on iOS. So on iOS those two containers go through the WebView decoder.
// Everything else (mp3/m4a/aac/wav), and ALL of Android (ExoPlayer handles
// Opus natively), plays straight through expo-audio.
const requiresWebAudioDecode = (container: AudioContainer) =>
  Platform.OS === 'ios' && (container === 'webm' || container === 'ogg');

const PlayGlyph = ({ color }: { color: string }) => (
  <Svg width={26} height={26} viewBox="0 0 24 24">
    <Path
      d="M7.5 5.2v13.6c0 .95 1.05 1.5 1.8.95l9.9-6.8c.65-.45.65-1.45 0-1.9L9.3 4.25c-.75-.55-1.8 0-1.8.95z"
      fill={color}
    />
  </Svg>
);

const PauseGlyph = ({ color }: { color: string }) => (
  <Svg width={24} height={24} viewBox="0 0 24 24">
    <Rect x={6.5} y={5} width={4} height={14} rx={1.4} fill={color} />
    <Rect x={13.5} y={5} width={4} height={14} rx={1.4} fill={color} />
  </Svg>
);

/**
 * A voice message the way the messengers draw it: a round play button,
 * the clip's waveform filling in as it plays (tap it to jump), and its
 * length — elapsed while playing — under the bars.
 *
 * The bars come from the sender's `waveForm` when there is one, otherwise
 * from decoding the file in the shared decoder (AudioDecoderHost), which
 * is also what makes the web client's WebM/Opus playable on iOS.
 */
const AudioMessage = ({
  src,
  mimeType,
  fileName,
  originalName,
  duration: durationProp,
  waveForm,
  isUser = false,
}: AudioMessageProps) => {
  const theme = useTheme();
  const t = useT();
  const soundRef = useRef<AudioPlayer | null>(null);
  // expo-audio delivers progress through an event subscription, so the
  // handle has to be held and removed alongside the player itself.
  const statusSubRef = useRef<{ remove: () => void } | null>(null);
  const preparedRef = useRef<PreparedSource | null>(null);
  const preparingRef = useRef<Promise<PreparedSource> | null>(null);
  const didFinishRef = useRef(false);
  const unmountedRef = useRef(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where to start once the player is up (a tap on the bars before play).
  const pendingSeekRef = useRef<number | null>(null);
  const rateRef = useRef(1);

  // The file's identity without its (rotating) access token, so caches
  // survive a token refresh.
  const cacheKey = src.split(/[?#]/)[0] || src;
  const metaPeaks = useMemo(() => parseWaveForm(waveForm), [waveForm]);
  const metaDuration = parseDurationSeconds(durationProp) * 1000;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(metaDuration);
  const [peaks, setPeaks] = useState<number[] | null>(metaPeaks);
  const [rate, setRate] = useState(1);
  const [waveWidth, setWaveWidth] = useState(0);

  // The brand colour from the config (the same tint as the composer's mic
  // and send buttons), on own and others' bubbles alike.
  const ink = theme.icon;
  const buttonFill = ink;
  const buttonGlyph = theme.textOnPrimary;
  const metaColor = isUser ? theme.messageTextUser : theme.textSecondary;

  const clearLoadingGuard = () => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };

  // expo-audio players are native shared objects: they are NOT garbage
  // collected with the component, so every one we create has to be
  // explicitly `remove()`d and its status subscription torn down first.
  const releasePlayer = () => {
    statusSubRef.current?.remove();
    statusSubRef.current = null;
    const player = soundRef.current;
    soundRef.current = null;
    if (player) {
      try {
        player.pause();
      } catch {
        /* already released */
      }
      try {
        player.remove();
      } catch {
        /* already released */
      }
    }
  };

  // Stable for this bubble's lifetime: what another bubble calls to pause
  // this one when it starts playing.
  const pauseSelf = useRef(() => {
    try {
      soundRef.current?.pause();
    } catch {
      /* released */
    }
    if (!unmountedRef.current) {setIsPlaying(false);}
  }).current;

  const claimPlayback = () => {
    if (pauseActive && pauseActive !== pauseSelf) {pauseActive();}
    pauseActive = pauseSelf;
  };

  const fail = (reason: unknown) => {
    clearLoadingGuard();
    if (unmountedRef.current) {
      return;
    }
    logAudioDebug('audio playback failed', {
      src,
      mimeType,
      fileName,
      originalName,
      container: preparedRef.current?.container,
      error:
        reason instanceof Error
          ? { name: reason.name, message: reason.message }
          : String(reason),
    });
    setIsLoading(false);
    setIsPlaying(false);
    setPlaybackError(true);
  };

  // Hard ceiling on the loading spinner — whatever stalls (a hung network
  // request, a decode that never returns, a player that never loads) the
  // control resolves to an error state instead of spinning forever.
  const armLoadingGuard = () => {
    clearLoadingGuard();
    loadingTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current && !soundRef.current) {
        fail(new Error('audio_timeout'));
      }
    }, 25000);
  };

  const cacheBase = () =>
    FileSystem.cacheDirectory
      ? `${FileSystem.cacheDirectory}ethora-audio-${hashString(cacheKey)}`
      : null;

  const sniff = async (uri: string): Promise<AudioContainer> => {
    try {
      const head = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
        position: 0,
        length: 32,
      });
      return detectContainer(decodeBase64Head(head, 16));
    } catch {
      return 'unknown';
    }
  };

  // Download once (shared by the waveform and playback), sniff the real
  // container, and give the cached file a real extension so AVFoundation /
  // ExoPlayer pick the right demuxer instead of choking on an opaque
  // `.blob` (the original `audio_timeout` cause).
  const prepareSource = (): Promise<PreparedSource> => {
    if (preparedRef.current) {
      return Promise.resolve(preparedRef.current);
    }
    if (preparingRef.current) {
      return preparingRef.current;
    }
    const run = async (): Promise<PreparedSource> => {
      const base = cacheBase();
      if (!/^https?:\/\//i.test(src) || !base) {
        // Local file (the sender's own clip while it uploads).
        return { localUri: src, container: await sniff(src) };
      }
      const wav = `${base}.wav`;
      if ((await FileSystem.getInfoAsync(wav)).exists) {
        return { localUri: wav, container: 'wav', playable: true };
      }
      const part = `${base}.part`;
      if (!(await FileSystem.getInfoAsync(part)).exists) {
        const download = await withTimeout(
          FileSystem.downloadAsync(withFileToken(src), part),
          12000,
          'audio_download_timeout'
        );
        if (download.status !== 200) {
          await FileSystem.deleteAsync(part, { idempotent: true }).catch(
            () => {}
          );
          throw new Error(`audio_download_status_${download.status}`);
        }
      }
      const container = await sniff(part);
      if (requiresWebAudioDecode(container)) {
        // Decoded to WAV before playing; the extension is irrelevant.
        return { localUri: part, container };
      }
      const ext =
        container !== 'unknown'
          ? getContainerExtension(container)
          : getIosAudioPlaybackCacheExtension({
              mime: mimeType,
              fileName,
              originalName,
              url: src,
            });
      const finalUri = `${base}${ext}`;
      if ((await FileSystem.getInfoAsync(finalUri)).exists) {
        await FileSystem.deleteAsync(part, { idempotent: true }).catch(() => {});
      } else {
        await FileSystem.moveAsync({ from: part, to: finalUri });
      }
      return { localUri: finalUri, container };
    };
    const pending = run().then(
      (prepared) => {
        preparedRef.current = prepared;
        preparingRef.current = null;
        logAudioDebug('audio prepared', {
          src,
          container: prepared.container,
          platform: Platform.OS,
        });
        return prepared;
      },
      (error) => {
        preparingRef.current = null;
        throw error;
      }
    );
    preparingRef.current = pending;
    return pending;
  };

  const readBase64 = async (uri: string) => {
    const info = await FileSystem.getInfoAsync(uri);
    const size = 'size' in info ? info.size ?? 0 : 0;
    if (size > MAX_DECODE_BYTES) {
      throw new Error('audio_too_large_to_decode');
    }
    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  };

  const remember = (analysis: Analysis) => {
    analysisCache.set(cacheKey, analysis);
    const base = cacheBase();
    if (base) {
      FileSystem.writeAsStringAsync(
        `${base}.wave.json`,
        JSON.stringify(analysis)
      ).catch(() => {});
    }
  };

  const applyAnalysis = (analysis: Analysis) => {
    if (unmountedRef.current) {return;}
    if (!metaPeaks && analysis.peaks.length) {setPeaks(analysis.peaks);}
    if (analysis.durationMillis > 0) {
      setDuration((current) => current || analysis.durationMillis);
    }
  };

  // Decode the clip once: its bars, its real length (MediaRecorder writes
  // WebM without a duration header), and — where the native player cannot
  // read it — a WAV copy to play.
  const decodeClip = async (prepared: PreparedSource) => {
    const wantWav = requiresWebAudioDecode(prepared.container) && !prepared.playable;
    const clip = await decodeAudioClip(await readBase64(prepared.localUri), {
      wantWav,
    });
    const analysis = { peaks: clip.peaks, durationMillis: clip.durationMillis };
    remember(analysis);
    applyAnalysis(analysis);
    const base = cacheBase();
    if (clip.wavBase64 && base) {
      const wavUri = `${base}.wav`;
      await FileSystem.writeAsStringAsync(wavUri, clip.wavBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await FileSystem.deleteAsync(prepared.localUri, { idempotent: true }).catch(
        () => {}
      );
      preparedRef.current = { localUri: wavUri, container: 'wav', playable: true };
    }
    return preparedRef.current ?? prepared;
  };

  // Full reset whenever the source changes (component reused for a new
  // message / re-render with a different src).
  const lastSrcRef = useRef(src);
  useEffect(() => {
    if (lastSrcRef.current === src) {return;}
    lastSrcRef.current = src;
    releasePlayer();
    preparedRef.current = null;
    preparingRef.current = null;
    didFinishRef.current = false;
    pendingSeekRef.current = null;
    clearLoadingGuard();
    setIsPlaying(false);
    setIsLoading(false);
    setPlaybackError(false);
    setPosition(0);
    setDuration(metaDuration);
    setPeaks(metaPeaks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // The waveform, as soon as the bubble shows: from the message itself,
  // from this session's cache, from the disk cache, or by decoding.
  useEffect(() => {
    if (!src || (metaPeaks && metaDuration > 0)) {return;}
    const cached = analysisCache.get(cacheKey);
    if (cached) {
      applyAnalysis(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      const base = cacheBase();
      if (base) {
        try {
          const stored = await FileSystem.readAsStringAsync(`${base}.wave.json`);
          const parsed = JSON.parse(stored) as Analysis;
          if (Array.isArray(parsed?.peaks)) {
            analysisCache.set(cacheKey, parsed);
            if (!cancelled) {applyAnalysis(parsed);}
            return;
          }
        } catch {
          /* not analysed yet */
        }
      }
      try {
        const prepared = await prepareSource();
        if (cancelled) {return;}
        await decodeClip(prepared);
      } catch (error) {
        // Not fatal: the bubble keeps flat bars and still plays.
        logAudioDebug('audio waveform unavailable', {
          src,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // expo-audio reports times in SECONDS; the UI is millisecond-based, so
  // convert at this boundary and nowhere else.
  const onPlaybackStatusUpdate = (status: AudioStatus) => {
    if (!status.isLoaded || unmountedRef.current) {
      return;
    }
    setPosition(Math.max(0, status.currentTime * 1000));
    // A WebM without a duration header reports 0 here: keep the decoded one.
    if (status.duration > 0) {setDuration(status.duration * 1000);}
    setIsPlaying(status.playing);
    if (status.didJustFinish) {
      didFinishRef.current = true;
      setIsPlaying(false);
      setPosition(0);
      const player = soundRef.current;
      if (player) {
        player.pause();
        void player.seekTo(0);
      }
    }
  };

  const startNativePlayback = async (localUri: string) => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true });
    } catch {
      /* non-fatal — still plays through the ringer channel */
    }
    // expo-audio has no awaitable create: the player loads in the
    // background and reports `isLoaded` via the status event. Wait for it
    // so the spinner resolves to real playback or the error state.
    const player = createAudioPlayer({ uri: localUri }, { updateInterval: 100 });
    let settleLoaded: (() => void) | null = null;
    const loaded = new Promise<void>((resolve) => {
      settleLoaded = resolve;
    });
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (status.isLoaded && settleLoaded) {
          settleLoaded();
          settleLoaded = null;
        }
        onPlaybackStatusUpdate(status);
      }
    );

    try {
      await withTimeout(loaded, 12000, 'audio_create_timeout');
    } catch (error) {
      subscription.remove();
      player.remove();
      throw error;
    }
    if (unmountedRef.current) {
      subscription.remove();
      player.remove();
      return;
    }
    soundRef.current = player;
    statusSubRef.current = subscription;
    if (rateRef.current !== 1) {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(rateRef.current);
    }
    const seek = pendingSeekRef.current;
    pendingSeekRef.current = null;
    if (seek !== null && player.duration > 0) {
      await player.seekTo(seek * player.duration);
    }
    claimPlayback();
    player.play();
    clearLoadingGuard();
    setIsLoading(false);
    setPlaybackError(false);
    setIsPlaying(true);
  };

  const togglePlayback = async () => {
    if (!src) {
      return;
    }

    // Already-loaded player → plain toggle.
    if (soundRef.current) {
      try {
        // `play()` / `pause()` emit no status event of their own, and the
        // time observer stops while paused — so set the state here or the
        // button latches on "pause" forever.
        if (isPlaying) {
          soundRef.current.pause();
          setIsPlaying(false);
        } else {
          if (didFinishRef.current) {
            await soundRef.current.seekTo(0);
            didFinishRef.current = false;
          }
          claimPlayback();
          soundRef.current.play();
          setIsPlaying(true);
        }
      } catch (error) {
        fail(error);
      }
      return;
    }

    // First tap → download (unless the waveform already did), decode where
    // the native player cannot, then play.
    setPlaybackError(false);
    setIsLoading(true);
    armLoadingGuard();
    try {
      let prepared = await withTimeout(
        prepareSource(),
        14000,
        'audio_prepare_timeout'
      );
      if (requiresWebAudioDecode(prepared.container) && !prepared.playable) {
        prepared = await decodeClip(prepared);
      }
      if (unmountedRef.current) {
        return;
      }
      await startNativePlayback(prepared.localUri);
    } catch (error) {
      fail(error);
    }
  };

  // A tap on the bars jumps there (and starts playing, as in Telegram).
  const seekFromTap = (event: GestureResponderEvent) => {
    if (!waveWidth || playbackError) {return;}
    const ratio = Math.max(
      0,
      Math.min(1, event.nativeEvent.locationX / waveWidth)
    );
    const player = soundRef.current;
    if (player && player.duration > 0) {
      didFinishRef.current = false;
      void player.seekTo(ratio * player.duration);
      setPosition(ratio * player.duration * 1000);
      if (!isPlaying) {
        claimPlayback();
        player.play();
        setIsPlaying(true);
      }
      return;
    }
    if (isLoading) {return;}
    pendingSeekRef.current = ratio;
    void togglePlayback();
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]!;
    rateRef.current = next;
    setRate(next);
    const player = soundRef.current;
    if (player) {
      player.shouldCorrectPitch = true;
      player.setPlaybackRate(next);
    }
  };

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      if (pauseActive === pauseSelf) {pauseActive = null;}
      clearLoadingGuard();
      releasePlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWaveLayout = (event: LayoutChangeEvent) => {
    const width = Math.floor(event.nativeEvent.layout.width);
    if (width !== waveWidth) {setWaveWidth(width);}
  };

  const barCount = waveWidth
    ? Math.max(8, Math.floor((waveWidth + BAR_GAP) / (BAR_WIDTH + BAR_GAP)))
    : 0;
  const bars = useMemo(
    () =>
      barCount
        ? resamplePeaks(peaks ?? new Array(barCount).fill(MIN_BAR), barCount)
        : [],
    [peaks, barCount]
  );

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const playedBars = Math.round(progress * bars.length);
  const started = isPlaying || position > 0;
  const timeLabel = playbackError
    ? t('media.audioUnavailable')
    : started
    ? formatClipTime(position)
    : duration > 0
    ? formatClipTime(duration)
    : '';

  return (
    <View style={styles.container} testID="audio-message">
      <Pressable
        testID="audio-play-button"
        accessibilityRole="button"
        accessibilityLabel={t(isPlaying ? 'media.audioPause' : 'media.audioPlay')}
        style={({ pressed }) => [
          styles.playButton,
          { backgroundColor: buttonFill, opacity: pressed ? 0.85 : 1 },
        ]}
        onPress={togglePlayback}
        disabled={isLoading}
        hitSlop={6}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={buttonGlyph} />
        ) : isPlaying ? (
          <PauseGlyph color={buttonGlyph} />
        ) : (
          <PlayGlyph color={buttonGlyph} />
        )}
      </Pressable>
      <View style={styles.track}>
        <Pressable
          testID="audio-waveform"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={seekFromTap}
          onLayout={onWaveLayout}
          style={styles.wave}
        >
          {bars.map((value, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                {
                  height: Math.max(BAR_WIDTH, Math.round(value * WAVE_HEIGHT)),
                  backgroundColor: ink,
                  opacity: index < playedBars ? 1 : 0.35,
                },
              ]}
            />
          ))}
        </Pressable>
        <View style={styles.metaRow}>
          <Text
            style={[styles.time, { color: metaColor }]}
            numberOfLines={1}
          >
            {timeLabel}
          </Text>
          {started && !playbackError ? (
            <Pressable
              testID="audio-speed"
              accessibilityRole="button"
              accessibilityLabel={t('media.audioSpeed')}
              onPress={cycleSpeed}
              hitSlop={8}
              style={[styles.speed, { backgroundColor: ink }]}
            >
              <Text style={[styles.speedText, { color: buttonGlyph }]}>
                {`${rate}×`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    // Media bubbles carry no padding of their own (images run edge to
    // edge), so the player brings the text bubble's inset with it.
    paddingTop: 10,
    paddingLeft: 10,
    paddingRight: 12,
    width: 250,
    maxWidth: '100%',
  },
  playButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: {
    flex: 1,
    gap: 4,
  },
  wave: {
    height: WAVE_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: BAR_GAP,
    overflow: 'hidden',
  },
  bar: {
    width: BAR_WIDTH,
    borderRadius: BAR_WIDTH / 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 16,
  },
  time: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
    opacity: 0.85,
  },
  speed: {
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    opacity: 0.85,
  },
  speedText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
});
