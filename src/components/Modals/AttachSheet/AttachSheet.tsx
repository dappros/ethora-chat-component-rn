/** @format */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraIcon, DocumentIcon } from '../../../assets/icons';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
import { getMediaLibrary } from '../../../helpers/mediaLibraryRuntime';
import {
  shouldClaimVerticalDrag,
  shouldDismissOnDrag,
} from '../../../helpers/sheetGestures';

interface RecentItem {
  id: string;
  uri: string;
  filename: string;
}

export interface PickedMedia {
  uri: string;
  name: string;
  mimeType?: string;
  isVideo: boolean;
}

interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onDocument: () => void;
  onPickMedia?: (media: PickedMedia) => void;
  primaryColor?: string;
}

// Starting translateY for the sheet. Larger than any realistic sheet
// height so it sits fully below the viewport before opening; the exact
// number doesn't matter visually because it animates to 0.
const SHEET_OFFSCREEN = 800;
// Re-exported so this sheet's own tests keep addressing them here.
export { shouldClaimVerticalDrag, shouldDismissOnDrag };

const RECENTS_COUNT = 12;
const THUMB_SIZE = 88;
const THUMB_DECODE = THUMB_SIZE * 2;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

const guessMimeType = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? 'image/jpeg';
};

const toRecentItem = async (
  MediaLibrary: any,
  asset: any
): Promise<RecentItem | null> => {
  const filename = asset?.filename || `photo_${asset?.id ?? Date.now()}`;
  if (asset?.uri && !asset.uri.startsWith('ph://')) {
    return { id: asset.id, uri: asset.uri, filename };
  }
  try {
    const info = await MediaLibrary?.getAssetInfoAsync?.(asset, {
      shouldDownloadFromNetwork: false,
    });
    if (!info?.localUri) {return null;}
    return { id: asset.id, uri: info.localUri, filename };
  } catch {
    return null;
  }
};

const AttachSheet: React.FC<AttachSheetProps> = ({
  visible,
  onClose,
  onCamera,
  onGallery,
  onDocument,
  onPickMedia,
  primaryColor = '#0052CD',
}) => {
  const { config } = useChatSettingState();
  const ts = config?.typography?.attachSheet;
  const pendingRef = useRef<(() => void) | null>(null);
  const runPending = () => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  };

  // Local "modal stays mounted while animating out" state. The parent
  // controls `visible`; we mirror it but delay unmount until the exit
  // animation has played so the slide-down is actually seen.
  const [mounted, setMounted] = useState(visible);

  // Two separate Animated values — the whole point of the rewrite:
  //   • backdropOpacity: fades the dim layer in/out (no slide).
  //   • sheetTranslateY: slides ONLY the sheet up from below.
  // RN Modal's built-in `animationType="slide"` slides the entire
  // contents (backdrop included) so the dim shade entered from the
  // bottom — what looked "awful". Splitting these gives the standard
  // bottom-sheet feel.
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslateY = useRef(
    new Animated.Value(SHEET_OFFSCREEN)
  ).current;

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (visible) {
      setMounted(true);
      // Reset to starting positions BEFORE the Modal becomes visible so
      // the first animated frame is below-the-fold (not a flash of the
      // settled sheet).
      backdropOpacity.setValue(0);
      sheetTranslateY.setValue(SHEET_OFFSCREEN);
      // requestAnimationFrame lets the Modal commit its mount before the
      // animation starts; without this the first frame can be skipped.
      const raf = requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 220,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            // Tuned for a quick-but-not-bouncy entry. tension is the
            // "stiffness" knob, friction the "damping" knob in RN's
            // spring config.
            tension: 90,
            friction: 14,
            useNativeDriver: true,
          }),
        ]).start();
      });
      return () => cancelAnimationFrame(raf);
    }
    if (!mounted) {return;}
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: SHEET_OFFSCREEN,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (!finished) {return;} // interrupted (rapid re-open) → leave state alone
      setMounted(false);
      if (Platform.OS !== 'ios') {
        runPending();
      }
    });
    return undefined;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeDragResponder = (claimOnStart: boolean) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => claimOnStart,
      onMoveShouldSetPanResponder: (_evt, g) =>
        claimOnStart || shouldClaimVerticalDrag(g.dy, g.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_evt, g) => {
        sheetTranslateY.setValue(Math.max(0, g.dy));
      },
      onPanResponderRelease: (_evt, g) => {
        if (shouldDismissOnDrag(g.dy, g.vy)) {
          onCloseRef.current();
          return;
        }
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          tension: 90,
          friction: 14,
          useNativeDriver: true,
        }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetTranslateY, {
          toValue: 0,
          tension: 90,
          friction: 14,
          useNativeDriver: true,
        }).start();
      },
    });

  const sheetPanRef = useRef<ReturnType<typeof makeDragResponder> | null>(null);
  const grabberPanRef = useRef<ReturnType<typeof makeDragResponder> | null>(null);
  if (!sheetPanRef.current) {sheetPanRef.current = makeDragResponder(false);}
  if (!grabberPanRef.current) {grabberPanRef.current = makeDragResponder(true);}
  const sheetPan = sheetPanRef.current;
  const grabberPan = grabberPanRef.current;

  const [recents, setRecents] = useState<RecentItem[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(false);
  const lastLoadRef = useRef(0);
  const RECENTS_TTL_MS = 15000;

  const loadRecents = useCallback(async () => {
    const MediaLibrary = getMediaLibrary();
    if (!MediaLibrary?.getAssetsAsync) {
      setLoadingRecents(false);
      return;
    }
    try {
      const perm = await MediaLibrary.getPermissionsAsync();
      if (!perm?.granted) {
        setRecents([]);
        return;
      }
      const page = await MediaLibrary.getAssetsAsync({
        first: RECENTS_COUNT,
        sortBy: [MediaLibrary.SortBy?.creationTime ?? 'creationTime'],
        mediaType: [MediaLibrary.MediaType?.photo ?? 'photo'],
      });
      const items = await Promise.all(
        (page?.assets ?? []).map((asset: any) => toRecentItem(MediaLibrary, asset))
      );
      lastLoadRef.current = Date.now();
      setRecents(items.filter(Boolean) as RecentItem[]);
    } catch (err) {
      console.warn('AttachSheet: could not read recent media', err);
      setRecents([]);
    } finally {
      setLoadingRecents(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) {return undefined;}
    if (recents.length && Date.now() - lastLoadRef.current < RECENTS_TTL_MS) {
      return undefined;
    }
    setLoadingRecents(true);
    const timer = setTimeout(() => {
      loadRecents();
    }, 250);
    return () => clearTimeout(timer);
  }, [visible]);

  const trigger = (handler: () => void) => () => {
    pendingRef.current = handler;
    if (Platform.OS === 'ios') {
      setMounted(false);
    }
    onClose();
  };

  const handleRecentPress = (item: RecentItem) =>
    trigger(() => {
      if (onPickMedia) {
        onPickMedia({
          uri: item.uri,
          name: item.filename,
          mimeType: guessMimeType(item.filename),
          isVideo: false,
        });
      } else {
        onGallery();
      }
    });

  const rows: {
    id: string;
    label: string;
    Icon: React.ComponentType<any>;
    handler: () => void;
  }[] = [
    {
      id: 'Document',
      label: 'Upload a File',
      Icon: DocumentIcon,
      handler: onDocument,
    },
  ];

  return (
    <Modal
      transparent
      visible={mounted}
      // We drive the animation ourselves — disable RN's built-in slide
      // (which slid the backdrop too) so the fade + spring above are the
      // only motion.
      animationType="none"
      onRequestClose={onClose}
      // Hardware-back / iOS gesture also routes through onClose, which
      // flips `visible` and triggers our exit animation above.
      onDismiss={Platform.OS === 'ios' ? runPending : undefined}
    >
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <TouchableOpacity
          testID="attach-backdrop"
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
          {...sheetPan.panHandlers}
        >
          <View
            testID="attach-grabber"
            style={styles.grabberArea}
            {...grabberPan.panHandlers}
          >
            <View style={styles.grabber} />
          </View>

          {/* Photos & Videos ------------------------------------------------ */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, chatTextStyle(ts?.title)]}>
              Photos & Videos
            </Text>
            <TouchableOpacity
              testID="attach-view-library"
              activeOpacity={0.6}
              onPress={trigger(onGallery)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text
                style={[
                  styles.sectionAction,
                  { color: primaryColor },
                  chatTextStyle(ts?.viewLibrary),
                ]}
              >
                View Library
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
            keyboardShouldPersistTaps="handled"
          >
            {/* Camera tile — always first, works without library access. */}
            <TouchableOpacity
              testID="attach-row-Camera"
              activeOpacity={0.7}
              style={styles.cameraTile}
              onPress={trigger(onCamera)}
            >
              <CameraIcon color="#8A8A8E" width={26} height={26} />
            </TouchableOpacity>

            {loadingRecents && recents.length === 0 && (
              <View style={styles.loadingTile}>
                <ActivityIndicator color="#8A8A8E" />
              </View>
            )}

            {recents.map((item) => (
              <TouchableOpacity
                key={item.id}
                testID={`attach-recent-${item.id}`}
                activeOpacity={0.8}
                style={styles.thumbWrap}
                onPress={handleRecentPress(item)}
              >
                <Image
                  source={{
                    uri: item.uri,
                    width: THUMB_DECODE,
                    height: THUMB_DECODE,
                  }}
                  style={styles.thumb}
                  resizeMethod="resize"
                  resizeMode="cover"
                  fadeDuration={0}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>

          <View style={styles.rowsDivider} />
          {rows.map(({ id, label, Icon, handler }) => (
            <TouchableOpacity
              key={id}
              testID={`attach-row-${id}`}
              activeOpacity={0.6}
              style={styles.row}
              onPress={trigger(handler)}
            >
              <View style={styles.rowIcon}>
                <Icon color="#1C1C1E" width={20} height={20} />
              </View>
              <Text style={[styles.rowLabel, chatTextStyle(ts?.rowLabel)]}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,15,20,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 16,
  },
  grabberArea: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 14,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9DE',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  sectionAction: {
    fontSize: 15,
    fontWeight: '500',
  },
  strip: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 8,
  },
  cameraTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E4E4E9',
    backgroundColor: '#FAFAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTile: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbWrap: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#EFEFF2',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  rowsDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#EFEFF2',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  rowIcon: {
    width: 28,
    alignItems: 'center',
    marginRight: 12,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1C1C1E',
  },
});

export default AttachSheet;
