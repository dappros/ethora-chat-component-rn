import React, { useEffect, useState } from 'react';
import { withFileToken } from '../../../helpers/secureFileUrl';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import GViewWebView from './GViewWebView';

interface PdfViewerProps {
  pdfUrl: string;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ pdfUrl }) => {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Android's WebView has NO native PDF renderer, so a file:// (or direct)
  // PDF loads blank. Route it through Google's gview embed using the
  // (public) remote URL — same approach as DocumentViewer for office docs.
  // iOS WKWebView renders PDFs natively, so we download + show the file.
  const isAndroid = Platform.OS === 'android';

  useEffect(() => {
    if (isAndroid) {
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const target = FileSystem.cacheDirectory + `pdf-${Date.now()}.pdf`;
        const result = await FileSystem.downloadAsync(withFileToken(pdfUrl), target);
        if (cancelled) {return;}
        setLocalUri(result.uri);
      } catch (e: any) {
        if (cancelled) {return;}
        console.log(e?.message);
        setError(e?.message || 'Download failed');
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, isAndroid]);

  if (isAndroid) {
    return <GViewWebView url={pdfUrl} />;
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text>Couldn't load PDF: {error}</Text>
      </View>
    );
  }

  if (!localUri) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        source={{ uri: localUri }}
        style={styles.webview}
        originWhitelist={['*']}
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
      />
    </View>
  );
};

export default PdfViewer;

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', backgroundColor: '#fff' },
  webview: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
