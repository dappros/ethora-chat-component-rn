/** @format */

import React, { useRef } from 'react';
import {
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

const AttachSheet: React.FC<AttachSheetProps> = ({
  visible,
  onClose,
  onCamera,
  onGallery,
  onDocument,
  primaryColor = '#0052CD',
}) => {
  const pendingRef = useRef<(() => void) | null>(null);

  const runPending = () => {
    const fn = pendingRef.current;
    pendingRef.current = null;
    fn?.();
  };

  const trigger = (handler: () => void) => () => {
    if (Platform.OS === 'ios') {
      pendingRef.current = handler;
      onClose();
    } else {
      onClose();
      setTimeout(handler, 150);
    }
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
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={runPending}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={styles.sheet}>
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
      </TouchableOpacity>
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
