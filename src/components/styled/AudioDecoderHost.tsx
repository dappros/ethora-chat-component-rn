import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { WAVEFORM_RESOLUTION } from '../../helpers/audioWaveform';

/**
 * One hidden WebView, shared by every voice message, used as an audio
 * DECODER (never as a player):
 *   • `decodeAudioData` is the only API on iOS that understands the WebM /
 *     Ogg Opus the web client records, and it works on a suspended
 *     AudioContext — decoding needs no user gesture.
 *   • On both platforms it is also how a bubble gets its waveform: RN has
 *     no PCM access to a file, the WebView does, so the bars are computed
 *     there with the same curve the web client uses.
 * Playing audio OUT of a WebView is gated behind an in-page gesture an RN
 * tap cannot supply, so when a playable copy is needed the page re-encodes
 * the PCM to WAV and ships it back; expo-audio plays that natively.
 *
 * Jobs run one at a time (each holds a whole clip in memory), and the
 * WebView is mounted only while there is work, then dropped after a while.
 */

// Largest WAV we ship back over the bridge. Voice messages are a couple
// hundred KB of WAV; this only guards against a multi-minute attachment.
export const MAX_DECODE_BYTES = 25 * 1024 * 1024;
const JOB_TIMEOUT_MS = 20000;
const IDLE_UNMOUNT_MS = 30000;

export interface DecodedClip {
  durationMillis: number;
  /** 0..1 bars, `WAVEFORM_RESOLUTION` of them. */
  peaks: number[];
  /** Only when asked for: the clip as a playable 16-bit WAV. */
  wavBase64?: string;
}

interface Job {
  id: number;
  base64: string;
  wantWav: boolean;
  resolve: (clip: DecodedClip) => void;
  reject: (error: Error) => void;
}

const queue: Job[] = [];
let nextId = 1;
let hosts = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/**
 * Decode a clip (base64 of the file as downloaded) to its waveform and
 * length, plus a WAV copy when `wantWav`. Rejects when no host is mounted,
 * the format cannot be decoded, or it takes too long.
 */
export const decodeAudioClip = (
  base64: string,
  { wantWav = false }: { wantWav?: boolean } = {}
): Promise<DecodedClip> =>
  new Promise((resolve, reject) => {
    if (hosts === 0) {
      reject(new Error('audio_decoder_unavailable'));
      return;
    }
    queue.push({ id: nextId++, base64, wantWav, resolve, reject });
    notify();
  });

const DECODER_HTML = `<!doctype html>
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
        var BARS = ${WAVEFORM_RESOLUTION};
        var MIN_BAR = 0.08;
        var post = function (payload) {
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        };
        var ctx = null;
        // Same curve as buildWaveformPeaks in helpers/audioWaveform.ts.
        var peaksOf = function (samples) {
          var bucket = Math.floor(samples.length / BARS);
          var out = [];
          var i;
          if (bucket < 1) { for (i = 0; i < BARS; i += 1) { out.push(MIN_BAR); } return out; }
          var rms = [];
          for (i = 0; i < BARS; i += 1) {
            var sum = 0;
            for (var j = i * bucket; j < (i + 1) * bucket; j += 1) { sum += samples[j] * samples[j]; }
            rms.push(Math.sqrt(sum / bucket));
          }
          var sorted = rms.slice().sort(function (a, b) { return a - b; });
          var ref = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 0;
          for (i = 0; i < BARS; i += 1) {
            if (ref <= 0) { out.push(MIN_BAR); continue; }
            var scaled = Math.sqrt(Math.min(rms[i] / ref, 1));
            out.push(Math.min(1, MIN_BAR + scaled * (1 - MIN_BAR)));
          }
          return out;
        };
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
        var fail = function (id, message) { post({ type: 'error', id: id, message: message }); };
        window.__decodeAudio = function (id, base64, wantWav) {
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
                  var result = {
                    type: 'decoded',
                    id: id,
                    durationMillis: Math.floor(decoded.duration * 1000),
                    peaks: peaksOf(decoded.getChannelData(0))
                  };
                  if (wantWav) {
                    var wav = encodeWav(decoded);
                    if (wav.byteLength > MAX_WAV) { fail(id, 'audio_too_long'); return; }
                    result.wavBase64 = abToBase64(wav);
                  }
                  post(result);
                } catch (e) {
                  fail(id, 'encode_failed:' + (e && e.message ? e.message : e));
                }
              },
              function (err) {
                fail(id, 'decode_failed:' + (err && err.message ? err.message : err));
              }
            );
          } catch (e) {
            fail(id, 'load_failed:' + (e && e.message ? e.message : e));
          }
        };
        post({ type: 'bridge_ready' });
      })();
    </script>
  </body>
</html>`;

type DecoderMessage =
  | { type: 'bridge_ready' }
  | {
      type: 'decoded';
      id: number;
      durationMillis: number;
      peaks: number[];
      wavBase64?: string;
    }
  | { type: 'error'; id: number; message?: string };

/**
 * Mounted once near the SDK root (ReduxWrapper). Renders nothing until a
 * voice message asks for a decode.
 */
export const AudioDecoderHost: React.FC = () => {
  const [mounted, setMounted] = useState(false);
  const webViewRef = useRef<WebView | null>(null);
  const readyRef = useRef(false);
  const activeRef = useRef<Job | null>(null);
  const jobTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pump = useCallback(() => {
    if (activeRef.current) {return;}
    const job = queue.shift();
    if (!job) {
      // Nothing left: let the WebView go after a quiet spell.
      if (idleTimerRef.current) {clearTimeout(idleTimerRef.current);}
      idleTimerRef.current = setTimeout(() => {
        if (!activeRef.current && !queue.length) {
          readyRef.current = false;
          setMounted(false);
        }
      }, IDLE_UNMOUNT_MS);
      return;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (!readyRef.current || !webViewRef.current) {
      // Not up yet: put it back and wait for bridge_ready.
      queue.unshift(job);
      setMounted(true);
      return;
    }
    activeRef.current = job;
    jobTimerRef.current = setTimeout(() => {
      finish(job.id, undefined, new Error('audio_decode_timeout'));
    }, JOB_TIMEOUT_MS);
    webViewRef.current.injectJavaScript(
      `window.__decodeAudio(${job.id}, ${JSON.stringify(job.base64)}, ${
        job.wantWav ? 'true' : 'false'
      }); true;`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(
    (id: number, clip?: DecodedClip, error?: Error) => {
      const job = activeRef.current;
      if (!job || job.id !== id) {return;}
      activeRef.current = null;
      if (jobTimerRef.current) {
        clearTimeout(jobTimerRef.current);
        jobTimerRef.current = null;
      }
      if (clip) {job.resolve(clip);}
      else {job.reject(error ?? new Error('audio_decode_failed'));}
      pump();
    },
    [pump]
  );

  useEffect(() => {
    hosts += 1;
    listeners.add(pump);
    pump();
    return () => {
      hosts -= 1;
      listeners.delete(pump);
      if (jobTimerRef.current) {clearTimeout(jobTimerRef.current);}
      if (idleTimerRef.current) {clearTimeout(idleTimerRef.current);}
      const active = activeRef.current;
      activeRef.current = null;
      active?.reject(new Error('audio_decoder_unmounted'));
      if (hosts === 0) {
        queue.splice(0).forEach((job) =>
          job.reject(new Error('audio_decoder_unmounted'))
        );
      }
    };
  }, [pump]);

  const onMessage = (event: WebViewMessageEvent) => {
    let payload: DecoderMessage;
    try {
      payload = JSON.parse(event.nativeEvent.data) as DecoderMessage;
    } catch {
      return;
    }
    if (payload.type === 'bridge_ready') {
      readyRef.current = true;
      pump();
      return;
    }
    if (payload.type === 'decoded') {
      finish(payload.id, {
        durationMillis: payload.durationMillis,
        peaks: payload.peaks,
        wavBase64: payload.wavBase64,
      });
      return;
    }
    finish(payload.id, undefined, new Error(payload.message || 'audio_decode_failed'));
  };

  if (!mounted) {return null;}
  return (
    <View style={styles.host} pointerEvents="none">
      <WebView
        ref={webViewRef}
        source={{ html: DECODER_HTML }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // iOS can kill the web content process under memory pressure:
        // fail the clip in flight and start a fresh page for the rest.
        onContentProcessDidTerminate={() => {
          readyRef.current = false;
          const active = activeRef.current;
          if (active) {
            finish(active.id, undefined, new Error('audio_decoder_crashed'));
          }
          webViewRef.current?.reload();
        }}
        javaScriptEnabled
        domStorageEnabled={false}
        scrollEnabled={false}
        pointerEvents="none"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        style={styles.webView}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  webView: {
    width: 1,
    height: 1,
    opacity: 0,
  },
});
