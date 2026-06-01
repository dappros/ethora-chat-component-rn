/** @format */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraIcon, DocumentIcon, MediaIcon } from '../../../assets/icons';

interface AttachSheetProps {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onGallery: () => void;
  onDocument: () => void;
  primaryColor?: string;
}

// Starting translateY for the sheet. Larger than any realistic sheet
// height so it sits fully below the viewport before opening; the exact
// number doesn't matter visually because it animates to 0.
const SHEET_OFFSCREEN = 600;

const AttachSheet: React.FC<AttachSheetProps> = ({
  visible,
  onClose,
  onCamera,
  onGallery,
  onDocument,
  primaryColor = '#0052CD',
}) => {
  // Pending handler captured on row tap — runs once the EXIT animation
  // finishes so iOS doesn't try to present an image picker over a
  // still-dismissing modal (was the original reason for the
  // platform-split + Modal.onDismiss dance). The animation completion
  // callback now drives this on both platforms.
  const pendingRef = useRef<(() => void) | null>(null);

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
    // Exit: fade the backdrop, slide the sheet down, then unmount and
    // fire any pending picker handler.
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
      const fn = pendingRef.current;
      pendingRef.current = null;
      fn?.();
    });
    return undefined;
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const trigger = (handler: () => void) => () => {
    // Capture the handler and ask parent to close. The exit-animation
    // completion above fires `handler` AFTER the sheet has slid away,
    // so iOS no longer tries to present a picker over a dismissing
    // modal — and Android no longer needs the ad-hoc 150ms setTimeout.
    pendingRef.current = handler;
    onClose();
  };

  const rows: {
    label: string;
    hint: string;
    Icon: React.ComponentType<any>;
    handler: () => void;
  }[] = [
    {
      label: 'Take photo',
      hint: 'Capture with the camera',
      Icon: CameraIcon,
      handler: onCamera,
    },
    {
      label: 'Photo or video',
      hint: 'Pick from your library',
      Icon: MediaIcon,
      handler: onGallery,
    },
    {
      label: 'Document',
      hint: 'Choose a file',
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
    >
      <Animated.View
        style={[styles.backdrop, { opacity: backdropOpacity }]}
      >
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: sheetTranslateY }] },
          ]}
        >
          <TouchableOpacity activeOpacity={1}>
            <View style={styles.grabber} />
            <Text style={styles.title}>Attach</Text>
            {rows.map(({ label, hint, Icon, handler }, idx) => (
              <TouchableOpacity
                key={label}
                activeOpacity={0.6}
                style={[
                  styles.row,
                  idx < rows.length - 1 && styles.rowDivider,
                ]}
                onPress={trigger(handler)}
              >
                <View
                  style={[
                    styles.iconBubble,
                    { backgroundColor: primaryColor + '14' },
                  ]}
                >
                  <Icon color={primaryColor} width={20} height={20} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{label}</Text>
                  <Text style={styles.rowHint}>{hint}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              activeOpacity={0.6}
              style={styles.cancelRow}
              onPress={onClose}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
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
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 32 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 16,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D9D9DE',
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A8A8E',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFF2',
  },
  iconBubble: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1C1C1E',
  },
  rowHint: {
    fontSize: 12,
    color: '#8A8A8E',
    marginTop: 2,
  },
  cancelRow: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: '#F2F2F7',
  },
  cancelLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1C1C1E',
  },
});

export default AttachSheet;
