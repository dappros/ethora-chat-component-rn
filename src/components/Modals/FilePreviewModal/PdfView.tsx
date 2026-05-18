import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';

interface PdfViewerProps {
  pdfUrl: string;
}

const PdfViewer: React.FC<PdfViewerProps> = ({ pdfUrl }) => {
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const target =
          FileSystem.cacheDirectory + `pdf-${Date.now()}.pdf`;
        const result = await FileSystem.downloadAsync(pdfUrl, target);
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
  }, [pdfUrl]);

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
