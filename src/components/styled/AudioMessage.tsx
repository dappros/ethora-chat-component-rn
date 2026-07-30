import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { PauseIcon, PlayIcon } from '../../assets/icons';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { getIosAudioPlaybackCacheExtension } from '../../helpers/mimeToExtension';
import { pushLog as devPushLog } from '../../utils/devLogger';

const formatTime = (millis: number) => {
  const safe = Number.isFinite(millis) && millis > 0 ? millis : 0;
  const totalSec = Math.floor(safe / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

type AudioMessageProps = {
  src: string;
  mimeType?: string;
  fileName?: string;
  originalName?: string;
  duration?: number | string;
  waveForm?: string;
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
  base64?: string;
};

type WebDecoderMessage =
  | { type: 'bridge_ready' }
  | { type: 'decoded'; durationMillis: number; wavBase64: string }
  | { type: 'error'; message?: string };

// Largest payload we will pull into JS for decoding (input opus) and the
// largest WAV we will ship back over the bridge (output PCM). Voice
// messages are a few dozen KB / a couple hundred KB of WAV; these only
// guard against a pathological multi-minute attachment.
const MAX_DECODE_BYTES = 25 * 1024 * 1024;

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

// The WebView is used ONLY as a decoder, never as a player. Two iOS facts
// force this shape:
//   • `decodeAudioData` is the only iOS API that understands WebM/Ogg Opus,
//     and it works on a suspended AudioContext (decoding needs no gesture).
//   • Playing audio OUT of a WebView — via AudioContext OR an <audio>
//     element — is gated behind an in-page user gesture that an RN-side tap
//     cannot supply, so both hang silently.
// Therefore the page decodes Opus → PCM, re-encodes to a WAV blob, and ships
// the bytes back to RN as base64. RN writes the WAV to cache and plays it
// through expo-audio (native, no gesture limits, real play/pause/seek).
const WEB_DECODER_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>html,body{margin:0;padding:0;width:1px;height:1px;overflow:hidden;background:transparent}</style>
  </head>
  <body>
    <script>
      (function () {
        var MAX_WAV = ${MAX_DECODE_BYTES};
        var post = function (payload) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        };
        var ctx = null;
        var encodeWav = function (buffer) {
          var numCh = buffer.numberOfChannels;
          var frames = buffer.length;
          var sr = buffer.sampleRate;
          var bytesLen = 44 + frames * numCh * 2;
          var ab = new ArrayBuffer(bytesLen);
          var view = new DataView(ab);
          var off = 0;
          var ws = function (s) { for (var i = 0; i < s.length; i += 1) { view.setUint8(off++, s.charCodeAt(i)); } };
          var u32 = function (d) { view.setUint32(off, d, true); off += 4; };
          var u16 = function (d) { view.setUint16(off, d, true); off += 2; };
          ws('RIFF'); u32(bytesLen - 8); ws('WAVE');
          ws('fmt '); u32(16); u16(1); u16(numCh); u32(sr); u32(sr * numCh * 2); u16(numCh * 2); u16(16);
          ws('data'); u32(frames * numCh * 2);
          var chans = [];
          for (var c = 0; c < numCh; c += 1) { chans.push(buffer.getChannelData(c)); }
          for (var f = 0; f < frames; f += 1) {
            for (var c2 = 0; c2 < numCh; c2 += 1) {
              var s = Math.max(-1, Math.min(1, chans[c2][f]));
              view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
              off += 2;
            }
          }
          return ab;
        };
        var abToBase64 = function (ab) {
          var bytes = new Uint8Array(ab);
          var binary = '';
          var chunk = 0x8000;
          for (var i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
          }
          return window.btoa(binary);
        };
        window.__decodeAudio = function (base64) {
          try {
            if (!ctx) {
              var Ctx = window.AudioContext || window.webkitAudioContext;
              ctx = new Ctx();
            }
            var bin = window.atob(base64);
            var len = bin.length;
            var bytes = new Uint8Array(len);
            for (var i = 0; i < len; i += 1) { bytes[i] = bin.charCodeAt(i); }
            ctx.decodeAudioData(
              bytes.buffer,
              function (decoded) {
                try {
                  var wav = encodeWav(decoded);
                  if (wav.byteLength > MAX_WAV) {
                    post({ type: 'error', message: 'audio_too_long' });
                    return;
                  }
                  post({
                    type: 'decoded',
                    durationMillis: Math.floor(decoded.duration * 1000),
                    wavBase64: abToBase64(wav),
                  });
                } catch (e) {
                  post({ type: 'error', message: 'encode_failed:' + (e && e.message ? e.message : e) });
                }
              },
              function (err) {
                post({ type: 'error', message: 'decode_failed:' + (err && err.message ? err.message : err) });
              }
            );
          } catch (e) {
            post({ type: 'error', message: 'load_failed:' + (e && e.message ? e.message : e) });
          }
        };
        post({ type: 'bridge_ready' });
      })();
    </script>
  </body>
</html>`;

const AudioMessage = ({
  src,
  mimeType,
  fileName,
  originalName,
}: AudioMessageProps) => {
  const { config } = useChatSettingState();
  const soundRef = useRef<AudioPlayer | null>(null);
  // expo-audio delivers progress through an event subscription instead of
  // expo-av's `onPlaybackStatusUpdate` callback argument, so the handle has
  // to be held and removed alongside the player itself.
  const statusSubRef = useRef<{ remove: () => void } | null>(null);
  const webViewRef = useRef<WebView | null>(null);
  const preparedRef = useRef<PreparedSource | null>(null);
  const bridgeReadyRef = useRef(false);
  const injectedRef = useRef(false);
  const didFinishRef = useRef(false);
  const unmountedRef = useRef(false);
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [webViewEnabled, setWebViewEnabled] = useState(false);
  const primaryColor = config?.colors?.primary || '#0A84FF';

  const clearLoadingGuard = () => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current);
      loadingTimerRef.current = null;
    }
  };

  // expo-audio players are native shared objects: they are NOT garbage
  // collected with the component, so every one we create has to be
  // explicitly `remove()`d (expo-av's `unloadAsync` equivalent) and its
  // status subscription torn down first.
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
  // request, a WebView that never decodes, a player that never loads)
  // the control resolves to an error state instead of spinning forever
  // (the customer-reported "stuck spinner").
  const armLoadingGuard = () => {
    clearLoadingGuard();
    loadingTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current && !soundRef.current) {
        fail(new Error('audio_timeout'));
      }
    }, 15000);
  };

  const prepareSource = async (): Promise<PreparedSource> => {
    if (preparedRef.current) {
      return preparedRef.current;
    }
    if (!/^https?:\/\//i.test(src)) {
      const prepared: PreparedSource = { localUri: src, container: 'unknown' };
      preparedRef.current = prepared;
      return prepared;
    }
    const cacheDirectory = FileSystem.cacheDirectory;
    if (!cacheDirectory) {
      const prepared: PreparedSource = { localUri: src, container: 'unknown' };
      preparedRef.current = prepared;
      return prepared;
    }

    const base = `${cacheDirectory}ethora-audio-${hashString(src)}`;
    const part = `${base}.part`;
    const partInfo = await FileSystem.getInfoAsync(part);
    if (!partInfo.exists) {
      const download = await withTimeout(
        FileSystem.downloadAsync(src, part),
        12000,
        'audio_download_timeout'
      );
      logAudioDebug('audio downloaded', {
        src,
        uri: download.status === 200 ? download.uri : undefined,
        status: download.status,
      });
      if (download.status !== 200) {
        throw new Error(`audio_download_status_${download.status}`);
      }
    }

    const head = await FileSystem.readAsStringAsync(part, {
      encoding: FileSystem.EncodingType.Base64,
      position: 0,
      length: 32,
    });
    const container = detectContainer(decodeBase64Head(head, 16));

    let base64: string | undefined;
    let localUri = part;
    if (requiresWebAudioDecode(container)) {
      // WebView-decode path: extension is irrelevant, we hand over the bytes.
      const info = await FileSystem.getInfoAsync(part);
      const size = 'size' in info ? info.size ?? 0 : 0;
      if (size > MAX_DECODE_BYTES) {
        throw new Error('audio_too_large_to_decode');
      }
      base64 = await FileSystem.readAsStringAsync(part, {
        encoding: FileSystem.EncodingType.Base64,
      });
    } else {
      // Native path: give the cached file a real extension so AVFoundation
      // / ExoPlayer pick the right demuxer instead of choking on an opaque
      // `.blob` (the original `audio_timeout` cause).
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
      const finalInfo = await FileSystem.getInfoAsync(finalUri);
      if (finalInfo.exists) {
        await FileSystem.deleteAsync(part, { idempotent: true }).catch(
          () => {}
        );
      } else {
        await FileSystem.moveAsync({ from: part, to: finalUri });
      }
      localUri = finalUri;
    }

    const prepared: PreparedSource = { localUri, container, base64 };
    preparedRef.current = prepared;
    logAudioDebug('audio prepared', {
      src,
      mimeType,
      fileName,
      originalName,
      container,
      platform: Platform.OS,
      decode: requiresWebAudioDecode(container) ? 'web-audio' : 'native',
    });
    return prepared;
  };

  const maybeInjectDecode = () => {
    const base64 = preparedRef.current?.base64;
    if (
      bridgeReadyRef.current &&
      base64 &&
      !injectedRef.current &&
      webViewRef.current
    ) {
      injectedRef.current = true;
      webViewRef.current.injectJavaScript(
        `window.__decodeAudio(${JSON.stringify(base64)}); true;`
      );
    }
  };

  // expo-audio reports times in SECONDS (expo-av used milliseconds); the
  // whole UI below is millisecond-based, so convert at this boundary and
  // nowhere else.
  const onPlaybackStatusUpdate = (status: AudioStatus) => {
    if (!status.isLoaded) {
      return;
    }
    setPosition(Math.max(0, status.currentTime * 1000));
    setDuration(status.duration > 0 ? status.duration * 1000 : 0);
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
    // expo-audio has no awaitable `createAsync`: the player is constructed
    // synchronously and loads in the background, reporting `isLoaded` via
    // the status event. Wait for that first loaded status (same 12s budget
    // expo-av's createAsync had) so the spinner still resolves to either
    // real playback or the error state, never to a silent dead button.
    const player = createAudioPlayer({ uri: localUri }, { updateInterval: 250 });
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
    player.play();
    clearLoadingGuard();
    setIsLoading(false);
    setPlaybackError(false);
    setIsPlaying(true);
    logAudioDebug('native audio playback started', {
      src,
      container: preparedRef.current?.container,
      localUri,
    });
  };

  // WebView finished decoding Opus → WAV: persist the WAV and play it
  // natively. From here it is indistinguishable from any other native clip.
  const onDecoded = async (durationMillis: number, wavBase64: string) => {
    try {
      const cacheDirectory = FileSystem.cacheDirectory || '';
      const wavUri = `${cacheDirectory}ethora-audio-${hashString(src)}.wav`;
      await FileSystem.writeAsStringAsync(wavUri, wavBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      if (unmountedRef.current) {
        return;
      }
      preparedRef.current = {
        localUri: wavUri,
        container: preparedRef.current?.container ?? 'webm',
      };
      if (durationMillis > 0) {
        setDuration(durationMillis);
      }
      setWebViewEnabled(false); // decoder no longer needed
      await startNativePlayback(wavUri);
    } catch (error) {
      fail(error);
    }
  };

  const handleWebMessage = (event: WebViewMessageEvent) => {
    let payload: WebDecoderMessage;
    try {
      payload = JSON.parse(event.nativeEvent.data) as WebDecoderMessage;
    } catch {
      return;
    }
    if (payload.type === 'bridge_ready') {
      bridgeReadyRef.current = true;
      maybeInjectDecode();
      return;
    }
    if (payload.type === 'decoded') {
      logAudioDebug('web audio decoded', {
        src,
        durationMillis: payload.durationMillis,
        wavBytes: payload.wavBase64 ? payload.wavBase64.length : 0,
      });
      void onDecoded(payload.durationMillis, payload.wavBase64);
      return;
    }
    // type === 'error'
    fail(new Error(payload.message || 'web_audio_error'));
  };

  const togglePlayback = async () => {
    if (!src) {
      return;
    }

    // Already-loaded native sound (covers both native formats AND the
    // decoded-WAV from the WebView path) → plain toggle.
    if (soundRef.current) {
      try {
        // `play()` / `pause()` emit NO status event of their own (expo-av's
        // playAsync/pauseAsync resolved with one). Playing state only ever
        // reaches us through the periodic time observer, and that observer
        // stops while paused — so without setting this here the button
        // would latch on "pause" forever and never resume.
        if (isPlaying) {
          soundRef.current.pause();
          setIsPlaying(false);
        } else {
          if (didFinishRef.current) {
            await soundRef.current.seekTo(0);
            didFinishRef.current = false;
          }
          soundRef.current.play();
          setIsPlaying(true);
        }
      } catch (error) {
        fail(error);
      }
      return;
    }

    // First tap → prepare (download + sniff) then route to the right engine.
    setPlaybackError(false);
    setIsLoading(true);
    armLoadingGuard();
    try {
      const prepared = await withTimeout(
        prepareSource(),
        14000,
        'audio_prepare_timeout'
      );
      if (unmountedRef.current) {
        return;
      }
      if (requiresWebAudioDecode(prepared.container)) {
        // Mount the decoder WebView; decoding + playback continue when the
        // 'decoded' message arrives (→ onDecoded → startNativePlayback).
        if (!webViewEnabled) {
          setWebViewEnabled(true);
        }
        maybeInjectDecode();
        return;
      }
      await startNativePlayback(prepared.localUri);
    } catch (error) {
      fail(error);
    }
  };

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      clearLoadingGuard();
      releasePlayer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Full reset whenever the source changes (component reused for a new
  // message / re-render with a different src).
  useEffect(() => {
    releasePlayer();
    preparedRef.current = null;
    bridgeReadyRef.current = false;
    injectedRef.current = false;
    didFinishRef.current = false;
    clearLoadingGuard();
    setIsPlaying(false);
    setIsLoading(false);
    setPlaybackError(false);
    setPosition(0);
    setDuration(0);
    setWebViewEnabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <View style={styles.root}>
      {/* Decoder WebView lives in a zero-size, absolutely-positioned host
          OUTSIDE the row so mounting/unmounting it during the loading phase
          can never shift the button or progress line (was the flicker). */}
      {webViewEnabled ? (
        <View style={styles.decoderHost} pointerEvents="none">
          <WebView
            ref={webViewRef}
            source={{ html: WEB_DECODER_HTML }}
            originWhitelist={['*']}
            onMessage={handleWebMessage}
            javaScriptEnabled
            domStorageEnabled={false}
            scrollEnabled={false}
            pointerEvents="none"
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            style={styles.hiddenWebView}
          />
        </View>
      ) : null}
      <View style={styles.container}>
        <TouchableOpacity
          testID="audio-play-button"
          accessibilityLabel="audio-play-button"
          style={[styles.playButton, { backgroundColor: primaryColor }]}
          onPress={togglePlayback}
          disabled={isLoading}
          activeOpacity={0.85}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <View style={styles.iconWrap}>
              {isPlaying ? (
                <PauseIcon width={18} height={18} color="#fff" />
              ) : (
                <PlayIcon width={18} height={18} color="#fff" />
              )}
            </View>
          )}
        </TouchableOpacity>
        <View style={styles.progressContainer}>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${progress * 100}%`, backgroundColor: primaryColor },
              ]}
            />
          </View>
          <View style={styles.progressRow}>
            <Text style={styles.time}>
              {playbackError ? 'Audio unavailable' : formatTime(position)}
            </Text>
            {/* Always render the right slot (empty until known) so the row
                never reflows when the duration appears after decoding. */}
            <Text style={styles.time}>
              {!playbackError && duration > 0 ? formatTime(duration) : ''}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

export default AudioMessage;

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  decoderHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    overflow: 'hidden',
    opacity: 0,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: 260,
    maxWidth: '100%',
  },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    marginLeft: 1,
  },
  progressContainer: {
    flex: 1,
    gap: 6,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressTrack: {
    height: 6,
    backgroundColor: '#D0D7E6',
    borderRadius: 999,
    overflow: 'hidden',
  },
  hiddenWebView: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  time: {
    fontSize: 12,
    color: '#667085',
    fontWeight: '500',
  },
});
