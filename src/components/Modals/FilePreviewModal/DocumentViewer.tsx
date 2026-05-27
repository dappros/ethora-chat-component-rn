import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

interface DocumentViewerProps {
  /** Public CDN URL of the doc. Must be reachable from Google's servers. */
  url: string;
  /** Optional display filename; used for the error fallback only. */
  fileName?: string;
}

/**
 * Inline preview for office documents (DOC / DOCX / XLS / XLSX / PPT /
 * PPTX / TXT / RTF / CSV) and other non-PDF formats supported by
 * Google's free gview rendering service.
 *
 * Strategy: embed `https://docs.google.com/gview?url=<encoded>&embedded=true`
 * inside a WebView. Google fetches the doc from its public URL and
 * renders it to a viewable iframe — no client-side dependency on
 * native office libraries, no extra peer dep. Works for any backend
 * whose file URLs are publicly reachable (which Ethora's `/files/`
 * already are — they're CDN URLs returned in `item.location`).
 *
 * Limitations (documented for the integrator):
 *   - Requires public URL — won't work for auth-gated downloads.
 *   - First load can take 2-5s on slow networks.
 *   - Read-only — no editing, no print/share buttons.
 *
 * For PDFs use the existing PdfViewer (downloads then renders locally).
 */
const DocumentViewer: React.FC<DocumentViewerProps> = ({ url, fileName }) => {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(
    url
  )}&embedded=true`;

  if (errored) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>
          {fileName || 'Document'}
        </Text>
        <Text style={styles.errorBody}>
          Couldn't render an inline preview. Tap the save icon above to
          download the file.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: viewerUrl }}
        style={styles.webview}
        originWhitelist={['*']}
        startInLoadingState
        onLoadEnd={() => setLoaded(true)}
        onError={() => setErrored(true)}
        onHttpError={() => setErrored(true)}
      />
      {!loaded && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      )}
    </View>
  );
};

export default DocumentViewer;

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', backgroundColor: '#fff' },
  webview: { flex: 1, backgroundColor: '#fff' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
  errorTitle: { fontSize: 16, fontWeight: '600' },
  errorBody: { color: '#666', textAlign: 'center' },
});
