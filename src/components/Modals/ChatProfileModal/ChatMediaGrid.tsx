/** @format */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSelector, useStore } from 'react-redux';
import type { RootState } from '../../../roomStore';
import type { ModalFile } from '../../../types/types';
import { collectRoomMedia } from '../../../helpers/roomMedia';
import { loadRoomHistory } from '../../../helpers/loadRoomHistory';
import { useFileToken } from '../../../hooks/useFileToken';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { useXmppClient } from '../../../context/xmppProvider';
import { useTheme } from '../../../hooks/useTheme';
import { getIconColor } from '../../../helpers/getIconColor';
import { useT } from '../../../i18n/useT';
import { PlayIcon } from '../../../assets/icons';
import type { ChatTheme } from '../../../theme/theme';

/** Older history pages asked for from here; one at a time per room. */
const inFlight = new Set<string>();
const PAGE_SIZE = 30;

interface ChatMediaGridProps {
  roomJid: string;
  /** Opens the viewer; the file comes with the whole grid as its siblings. */
  onOpen: (file: ModalFile) => void;
}

/**
 * The chat profile's Media tab: a three-column grid of the room's pictures
 * and videos. It shows what history is loaded and pages older history in on
 * demand, the same MAM pages the message list asks for.
 */
const ChatMediaGrid: React.FC<ChatMediaGridProps> = ({ roomJid, onOpen }) => {
  const t = useT();
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const store = useStore<RootState>();
  const { client } = useXmppClient();
  const fileToken = useFileToken();
  const { user, config } = useChatSettingState();
  const messages = useSelector(
    (state: RootState) => state.rooms.rooms?.[roomJid]?.messages
  );
  const historyComplete = useSelector(
    (state: RootState) => !!state.rooms.rooms?.[roomJid]?.historyComplete
  );
  const [loadingMore, setLoadingMore] = useState(false);

  const files = useMemo(
    () =>
      collectRoomMedia(messages, roomJid, {
        me: user,
        fileToken,
        interactive: !config?.disableInteractions,
        repliesOn: !config?.disableReplies,
      }),
    [messages, roomJid, user, fileToken, config?.disableInteractions, config?.disableReplies]
  );

  const loadMore = () =>
    loadRoomHistory({
      client,
      room: store.getState().rooms.rooms?.[roomJid],
      inFlight,
      chatJID: roomJid,
      max: PAGE_SIZE,
      onBusyChange: setLoadingMore,
    });

  return (
    <View>
      {files.length === 0 && !loadingMore ? (
        <Text testID="chat-profile-media-empty" style={styles.empty}>
          {t('modal.chatProfile.mediaEmpty')}
        </Text>
      ) : (
        <View style={styles.grid}>
          {files.map((file, index) => {
            const isVideo = file.mimetype.startsWith('video/');
            const thumb = isVideo ? file.previewURL : file.fileURL;
            return (
              <TouchableOpacity
                key={`${file.source?.messageId}-${index}`}
                testID={`chat-profile-media-${index}`}
                activeOpacity={0.8}
                style={styles.tile}
                onPress={() => onOpen({ ...file, siblings: files, index })}
              >
                {!!thumb && (
                  <Image source={{ uri: thumb }} style={styles.image} resizeMode="cover" />
                )}
                {isVideo && (
                  <View style={styles.videoBadge} pointerEvents="none">
                    <PlayIcon width={18} height={18} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {loadingMore ? (
        <ActivityIndicator style={styles.more} color={getIconColor(config)} />
      ) : (
        !historyComplete && (
          <TouchableOpacity
            testID="chat-profile-media-load-more"
            activeOpacity={0.7}
            style={styles.more}
            onPress={loadMore}
          >
            <Text style={[styles.moreLabel, { color: getIconColor(config) }]}>
              {t('search.messages.loadMore')}
            </Text>
          </TouchableOpacity>
        )
      )}
    </View>
  );
};

const createStyles = (theme: ChatTheme) => StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tile: {
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: theme.dark ? theme.surfaceSecondary : '#1F1F1F',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  videoBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    paddingVertical: 16,
    textAlign: 'center',
    color: theme.textSecondary,
  },
  more: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  moreLabel: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default ChatMediaGrid;
