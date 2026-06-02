import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface GViewWebViewProps {
  url: string;
  onError?: () => void;
}

const MAX_ATTEMPTS = 6;
const LOAD_BUDGET_MS = 8000;
const ATTEMPT_TIMEOUT_MS = 3000;

const RENDER_POLLER = `
(function () {
  if (window.__ethoraGviewProbe) { return; }
  window.__ethoraGviewProbe = true;
  var tries = 0;
  function rendered() {
    try {
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        // naturalHeight is readable even for cross-origin images; gview's
        // page images are tall, the preparing page has none.
        if (imgs[i].naturalHeight > 80) { return true; }
      }
      // Some gview render paths paint pages into <canvas> instead.
      var canvases = document.querySelectorAll('canvas');
      for (var j = 0; j < canvases.length; j++) {
        if (canvases[j].height > 80) { return true; }
      }
      var txt = ((document.body && document.body.innerText) || '').trim();
      return txt.length > 80;
    } catch (e) {
      return false;
    }
  }
  function tick() {
    tries++;
    if (rendered()) {
      try {
        window.ReactNativeWebView.postMessage(JSON.stringify({ rendered: true }));
      } catch (e) {}
      return;
    }
    if (tries < 40) { setTimeout(tick, 500); }
  }
  tick();
})();
true;
`;

const GViewWebView: React.FC<GViewWebViewProps> = ({ url, onError }) => {
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const attemptRef = useRef(0);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const viewerUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(
    url
  )}`;

  const clearWatchdog = () => {
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
  };

  const giveUpAttempt = useCallback(() => {
    if (readyRef.current) {return;}
    if (attemptRef.current < MAX_ATTEMPTS - 1) {
      attemptRef.current += 1;
      setAttempt(attemptRef.current);
    } else {
      readyRef.current = true;
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (readyRef.current) {return;}
    clearWatchdog();
    watchdog.current = setTimeout(giveUpAttempt, LOAD_BUDGET_MS);
    return clearWatchdog;
  }, [attempt, giveUpAttempt]);

  const handleLoadEnd = useCallback(() => {
    if (readyRef.current) {return;}
    clearWatchdog();
    watchdog.current = setTimeout(giveUpAttempt, ATTEMPT_TIMEOUT_MS);
  }, [giveUpAttempt]);

  const handleMessage = useCallback((e: any) => {
    let isRendered = false;
    try {
      isRendered = !!JSON.parse(e.nativeEvent.data)?.rendered;
    } catch {
      isRendered = false;
    }
    if (isRendered && !readyRef.current) {
      clearWatchdog();
      readyRef.current = true;
      setReady(true);
    }
  }, []);

  return (
    <View style={styles.container}>
      <WebView
        key={attempt}
        source={{ uri: viewerUrl }}
        style={styles.webview}
        originWhitelist={['*']}
        injectedJavaScript={RENDER_POLLER}
        onLoadEnd={handleLoadEnd}
        onMessage={handleMessage}
        onError={onError}
        onHttpError={onError}
      />
      {!ready && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}
    </View>
  );
};

export default GViewWebView;

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', backgroundColor: '#fff' },
  webview: { flex: 1, backgroundColor: '#fff' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
});
