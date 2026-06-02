import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import GViewWebView from './GViewWebView';

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
 *
 * Limitations (documented for the integrator):
 *   - Requires public URL — won't work for auth-gated downloads.
 *   - First load can take 2-5s on slow networks.
 *   - Read-only — no editing, no print/share buttons.
 *
 */
const DocumentViewer: React.FC<DocumentViewerProps> = ({ url, fileName }) => {
  const [errored, setErrored] = useState(false);

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

  return <GViewWebView url={url} onError={() => setErrored(true)} />;
};

export default DocumentViewer;

const styles = StyleSheet.create({
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
