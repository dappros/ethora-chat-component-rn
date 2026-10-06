import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LockIcon } from '../../assets/icons';
import FileDownload from '../styled/UnsupportedType';
import CustomMessageImage from '../styled/MessageImage';
import CustomMessageVideo from '../styled/VideoMessage';
import AudioMessage from '../styled/AudioMessage';
import {
  BackgroundFile,
  FileInformation,
  FileName,
  FileSize,
  FileSizeContainer,
  UnsupportedContainer,
} from '../styled/StyledInputComponents/MediaComponents';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { useChatSettingState } from '../../hooks/useChatSettingState';
import { IMessage } from '../../types/types';
import { withFileToken } from '../../helpers/secureFileUrl';
import type { OpenedFile } from '../../e2ee/sealedFiles';

const sealedFiles = () =>
  require('../../e2ee/sealedFiles') as typeof import('../../e2ee/sealedFiles');

interface SealedRef {
  location: string;
  size?: string | number;
}

export const sealedAttachmentsOf = (message?: IMessage | null): SealedRef[] => {
  if (!message) {return [];}
  let raw: unknown = (message as any).attachments;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = undefined;
    }
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .filter((item) => item && typeof item.location === 'string' && item.location)
      .map((item) => ({ location: item.location, size: item.size }));
  }
  return message.location
    ? [{ location: message.location, size: message.size }]
    : [];
};

const formatBytes = (value?: string | number): string => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {return '';}
  if (bytes < 1024) {return `${bytes} B`;}
  if (bytes < 1024 * 1024) {return `${(bytes / 1024).toFixed(0)} KB`;}
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

type CardState = 'idle' | 'working' | 'failed';

const SealedItem: React.FC<{
  attachment: SealedRef;
  keyMaterial?: string;
  isUser: boolean;
}> = ({ attachment, keyMaterial, isUser }) => {
  const theme = useTheme();
  const t = useT();
  const { config } = useChatSettingState();
  const [state, setState] = useState<CardState>('idle');
  const [progress, setProgress] = useState(0);
  const [opened, setOpened] = useState<OpenedFile | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const { location } = attachment;

  useEffect(() => {
    if (!keyMaterial || !location) {return;}
    let active = true;
    sealedFiles()
      .findOpened(location)
      .then((found) => {
        if (active && found) {setOpened(found);}
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [keyMaterial, location]);

  const handlePress = useCallback(async () => {
    if (opened || !keyMaterial || !location || state === 'working') {return;}
    setState('working');
    setProgress(0);
    try {
      const file = await sealedFiles().openSealedAttachment(
        location,
        withFileToken(location),
        keyMaterial,
        (fraction) => {
          if (mounted.current) {setProgress(fraction);}
        }
      );
      if (!mounted.current) {return;}
      setOpened(file);
      setState('idle');
    } catch (error) {
      console.warn('sealed attachment could not be opened', error);
      if (mounted.current) {setState('failed');}
    }
  }, [keyMaterial, location, opened, state]);

  if (opened) {
    if (opened.mimetype.startsWith('image/')) {
      return (
        <View testID="sealed-attachment-image">
          <CustomMessageImage
            fileName={opened.name}
            originalName={opened.name}
            fileURL={opened.uri}
            locationPreview={opened.uri}
            mimetype={opened.mimetype}
          />
        </View>
      );
    }
    if (opened.mimetype.startsWith('video/')) {
      return (
        <CustomMessageVideo
          fileName={opened.name}
          originalName={opened.name}
          fileURL={opened.uri}
          mimetype={opened.mimetype}
        />
      );
    }
    if (opened.mimetype.startsWith('audio/')) {
      return (
        <AudioMessage
          src={opened.uri}
          mimeType={opened.mimetype}
          fileName={opened.name}
          originalName={opened.name}
        />
      );
    }
    return (
      <View testID="sealed-attachment">
        <FileDownload
          fileURL={opened.uri}
          fileName={opened.name}
          originalName={opened.name}
          mimetype={opened.mimetype}
          isUser={isUser}
        />
      </View>
    );
  }

  const canOpen = !!keyMaterial && !!location;
  const working = state === 'working';
  const note = !canOpen
    ? t(
        config?.e2ee?.enabled === true
          ? 'media.sealedUnavailable'
          : 'media.sealedUnsupported'
      )
    : working
      ? `${t('media.sealedDownloading')} ${Math.round(progress * 100)}%`
      : state === 'failed'
        ? t('media.sealedDownloadFailed')
        : formatBytes(attachment.size) || t('media.sealedDownload');

  return (
    <UnsupportedContainer
      isUser={isUser}
      onPress={handlePress}
      disabled={!canOpen || working}
      activeOpacity={canOpen && !working ? 0.7 : 1}
      testID="sealed-attachment"
      accessibilityRole="button"
      accessibilityLabel={t(canOpen ? 'media.sealedDownload' : 'media.sealedFile')}
    >
      <BackgroundFile>
        {working ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <LockIcon width={26} height={26} color={theme.textSecondary} />
        )}
      </BackgroundFile>
      <FileInformation>
        <FileName
          numberOfLines={1}
          isUser={isUser}
          colorIsUser={config?.colors?.primary}
          colorUsers={config?.colors?.secondary}
        >
          {t('media.sealedFile')}
        </FileName>
        <FileSizeContainer style={styles.note}>
          <FileSize
            numberOfLines={2}
            style={state === 'failed' && canOpen ? { color: theme.danger } : undefined}
          >
            {note}
          </FileSize>
        </FileSizeContainer>
      </FileInformation>
    </UnsupportedContainer>
  );
};

const SealedAttachment: React.FC<{ message?: IMessage; isUser: boolean }> = ({
  message,
  isUser,
}) => {
  const attachments = sealedAttachmentsOf(message);
  const keys = message?.e2eeKeys;
  if (attachments.length === 0) {
    return <SealedItem attachment={{ location: '' }} isUser={isUser} />;
  }
  return (
    <View style={styles.stack}>
      {attachments.map((attachment, index) => (
        <SealedItem
          key={attachment.location || index}
          attachment={attachment}
          keyMaterial={keys?.[index]}
          isUser={isUser}
        />
      ))}
    </View>
  );
};

export default SealedAttachment;

const styles = StyleSheet.create({
  stack: {
    gap: 8,
  },
  note: {
    flexShrink: 1,
    borderRadius: 10,
  },
});
