/** @format */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ModalContainerFullScreen } from '../styledModalComponents';
import {
  ChatIcon,
  EditIcon,
  IconDoc,
  LeaveIcon,
  LogoutIcon,
  ProfileIcon,
  ShareIcon,
} from '../../../assets/icons';
import { useAppDispatch } from '../../../hooks/hooks';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { useXmppClient } from '../../../context/xmppProvider';
import { useToast } from '../../../context/ToastContext';
import { useT } from '../../../i18n/useT';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
import { getIconColor } from '../../../helpers/getIconColor';
import { chatTextStyle } from '../../../helpers/typography';
import { getElementFont } from '../../../helpers/getElementFont';
import { LANGUAGE_OPTIONS } from '../../../helpers/constants/LANGUAGE_OPTIONS';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import {
  setActiveFile,
  setActiveModal,
  setLangSource,
  setSelectedUser,
} from '../../../roomStore/chatSettingsSlice';
import { addRoomViaApi, setCurrentRoom } from '../../../roomStore/roomsSlice';
import { runLogoutFlow } from '../../Menu/HeaderRoomListMenu';
import { useLogout } from '../../../hooks/useLogout';
import { ApiRoom, postPrivateRoom } from '../../../networking/api-requests/rooms.api';
import {
  getUserFiles,
  isMediaFile,
  UserFile,
} from '../../../networking/api-requests/user.api';
import { createRoomFromApi } from '../../../helpers/createRoomFromApi';
import { walletToUsername } from '../../../helpers/walletUsername';
import { Iso639_1Codes } from '../../../types/types';
import {
  ProfileHero,
  ProfileTopBar,
  HeroAction,
  useHeaderMetrics,
} from '../ProfileHeader/ProfileHeader';
import EditUserModal from './EditUserModal';

const PREFIX = 'user-profile';

type TabKey = 'language' | 'media' | 'documents';

/** Two uppercase letters for a person without a picture. */
export const userInitials = (name?: string | null): string => {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const letters = (words.length >= 2
    ? [words[0][0], words[1][0]]
    : [words[0]?.[0], words[0]?.[1]]
  ).filter((c) => !!c && /[\p{L}\p{N}]/u.test(c));
  return letters.join('').toUpperCase();
};

/**
 * Which tabs a profile shows. Only the signed-in user has tabs at all:
 * `GET /v2/files/` returns the JWT owner's files, so there is nothing to
 * put under Media/Documents for anybody else, and the language picker is
 * a personal setting.
 */
export const profileTabs = (opts: {
  isOwnProfile: boolean;
  translatesEnabled: boolean;
  hasMedia: boolean;
  hasDocuments: boolean;
}): TabKey[] => {
  if (!opts.isOwnProfile) {return [];}
  const tabs: TabKey[] = [];
  if (opts.translatesEnabled) {tabs.push('language');}
  if (opts.hasMedia) {tabs.push('media');}
  if (opts.hasDocuments) {tabs.push('documents');}
  return tabs;
};

interface UserProfileModalProps {
  handleCloseModal: any;
}

const UserProfileModal: React.FC<UserProfileModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const dispatch = useAppDispatch();
  const { client } = useXmppClient();
  const { showToast } = useToast();
  const { config, user, selectedUser, langSource } = useChatSettingState();
  const fileToken = useFileToken();

  const [isEditing, setIsEditing] = useState(false);
  const [files, setFiles] = useState<UserFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey | null>(null);

  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const { collapseDistance } = useHeaderMetrics();
  const [viewportHeight, setViewportHeight] = useState(0);

  const isOwnProfile = !selectedUser;
  const profileUser: any = selectedUser ?? user;

  const media = useMemo(() => files.filter(isMediaFile), [files]);
  const documents = useMemo(
    () => files.filter((file) => !isMediaFile(file)),
    [files]
  );

  const tabs = useMemo(
    () =>
      profileTabs({
        isOwnProfile,
        translatesEnabled: !!config?.translates?.enabled,
        hasMedia: media.length > 0,
        hasDocuments: documents.length > 0,
      }),
    [isOwnProfile, config?.translates?.enabled, media.length, documents.length]
  );

  // Keep the selected tab valid as the lists load in.
  useEffect(() => {
    if (tabs.length === 0) {
      setActiveTab(null);
      return;
    }
    setActiveTab((current) =>
      current && tabs.includes(current) ? current : tabs[0]
    );
  }, [tabs]);

  // One request per visit, and only for one's own profile — the endpoint
  // is scoped to the JWT owner, so it would return *our* files while
  // looking at somebody else's page.
  useEffect(() => {
    if (!isOwnProfile) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoadingFiles(true);
    getUserFiles()
      .then((rows) => {
        if (!cancelled) {setFiles(rows);}
      })
      .catch((error) => {
        console.warn('Could not load user files:', error);
        if (!cancelled) {setFiles([]);}
      })
      .finally(() => {
        if (!cancelled) {setLoadingFiles(false);}
      });
    return () => {
      cancelled = true;
    };
  }, [isOwnProfile, user?.token]);

  const handleBackClick = useCallback(() => {
    dispatch(setSelectedUser(undefined));
    handleCloseModal();
  }, [dispatch, handleCloseModal]);

  // Same teardown the room-list menu runs (XMPP, redux, persisted slices,
  // AsyncStorage), including the host's confirm copy and callbacks.
  const performLogout = useLogout();
  const handleLogout = useCallback(() => {
    runLogoutFlow(config?.logout ?? { enabled: true }, performLogout).catch(() => {});
  }, [config?.logout, performLogout]);

  const handleShare = useCallback(async () => {
    const name =
      profileUser?.name ||
      `${profileUser?.firstName ?? ''} ${profileUser?.lastName ?? ''}`.trim();
    const id =
      profileUser?.userJID ||
      profileUser?.defaultWallet?.walletAddress ||
      profileUser?.id ||
      '';
    try {
      await Share.share({ message: id ? `${name}\n${id}` : name });
    } catch (error) {
      console.warn('Could not share the profile:', error);
    }
  }, [profileUser]);

  const handleRoomCreation = async (
    newChat: ApiRoom,
    usersArrayLength: number
  ) => {
    try {
      const normalizedChat = createRoomFromApi(
        newChat,
        config?.xmppSettings?.conference,
        usersArrayLength
      );

      if (!normalizedChat || !client) {return;}

      dispatch(addRoomViaApi({ room: normalizedChat, xmpp: client }));
      dispatch(setCurrentRoom({ roomJID: normalizedChat?.jid || '' }));

      showToast({
        id: Date.now().toString(),
        title: 'Success!',
        message: 'Room created succusfully!',
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('Error handling room creation:', error);
    }
  };

  const handlePrivateMessage = useCallback(async () => {
    showToast({
      id: Date.now().toString(),
      title: 'Room creation',
      message: 'Room is being created...',
      type: 'info',
      duration: 3000,
    });
    if (config?.newArch) {
      const newRoom = await postPrivateRoom(
        selectedUser?.userJID ?? (selectedUser?.id || '')
      );
      handleRoomCreation(newRoom, 2);
    } else {
      const selectedUserUsername = walletToUsername(selectedUser?.id || '');
      const myUsername = walletToUsername(user.defaultWallet.walletAddress);

      const roomJid = [myUsername, selectedUserUsername]
        .sort()
        .join('.')
        .toLowerCase();

      const combinedUsersName = [
        user.firstName,
        selectedUser?.name?.split(' ')?.[0] || '',
      ]
        .sort()
        .join(' and ');

      const newRoomJid =
        (await client?.createPrivateRoomStanza(
          combinedUsersName,
          `Private chat ${combinedUsersName}`,
          roomJid
        )) || '';

      if (newRoomJid) {
        await client?.inviteRoomRequestStanza(selectedUserUsername, newRoomJid);
        await client?.getRoomsStanza();
      }
    }

    dispatch(setActiveModal(undefined));
  }, [selectedUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = (file: UserFile) => {
    dispatch(
      setActiveFile({
        fileName: file.name,
        fileURL: file.url,
        mimetype: file.mimetype,
      })
    );
    dispatch(setActiveModal(MODAL_TYPES.FILE_PREVIEW));
  };

  const heroActions: HeroAction[] = useMemo(
    () =>
      isOwnProfile
        ? [
            {
              key: 'account',
              label: t('action.account'),
              icon: (color: string) => <ProfileIcon color={color} />,
              onPress: () => dispatch(setActiveModal(MODAL_TYPES.SETTINGS)),
            },
            {
              key: 'share',
              label: t('action.share'),
              icon: (color: string) => <ShareIcon color={color} />,
              onPress: handleShare,
            },
            {
              key: 'edit',
              label: t('action.edit'),
              icon: (color: string) => <EditIcon color={color} />,
              onPress: () => setIsEditing(true),
            },
            {
              key: 'logout',
              label: t('action.logOut'),
              icon: (color: string) => <LogoutIcon color={color} />,
              onPress: handleLogout,
            },
          ]
        : [
            ...(config?.hideMemberSendMessageAction
              ? []
              : [
                  {
                    key: 'message',
                    label: t('action.message'),
                    icon: (color: string) => <ChatIcon color={color} />,
                    onPress: handlePrivateMessage,
                  },
                ]),
            {
              key: 'share',
              label: t('action.share'),
              icon: (color: string) => <ShareIcon color={color} />,
              onPress: handleShare,
            },
          ],
    [isOwnProfile, t, handleShare, handlePrivateMessage, handleLogout] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (isEditing) {
    return (
      <ModalContainerFullScreen>
        <EditUserModal
          setIsEditing={setIsEditing}
          modalUser={profileUser}
          config={config}
        />
      </ModalContainerFullScreen>
    );
  }

  const displayName =
    profileUser?.name ||
    `${profileUser?.firstName ?? ''} ${profileUser?.lastName ?? ''}`.trim() ||
    t('modal.profile.title');
  const heroImage =
    appendFileToken(profileUser?.profileImage, fileToken) || null;
  const heroColor = config?.colors?.avatar || getIconColor(config);
  const description = profileUser?.description;

  const renderTabBody = () => {
    if (activeTab === 'language') {
      return (
        <View>
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = langSource === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                testID={`${PREFIX}-language-${option.id}`}
                activeOpacity={0.7}
                style={styles.languageRow}
                onPress={() =>
                  dispatch(setLangSource(option.id as Iso639_1Codes))
                }
              >
                <Text style={styles.languageLabel}>{option.name}</Text>
                {selected && (
                  <Text style={[styles.check, { color: getIconColor(config) }]}>
                    ✓
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      );
    }

    if (activeTab === 'media') {
      return (
        <View style={styles.mediaGrid}>
          {media.map((file) => (
            <TouchableOpacity
              key={file.id}
              testID={`${PREFIX}-media-${file.id}`}
              activeOpacity={0.8}
              style={styles.mediaTile}
              onPress={() => openFile(file)}
            >
              <Image
                source={{ uri: appendFileToken(file.url, fileToken) || file.url }}
                style={styles.mediaImage}
                resizeMode="cover"
              />
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    return (
      <View>
        {documents.map((file) => (
          <TouchableOpacity
            key={file.id}
            testID={`${PREFIX}-document-${file.id}`}
            activeOpacity={0.7}
            style={styles.documentRow}
            onPress={() => openFile(file)}
          >
            <IconDoc />
            <View style={styles.documentText}>
              <Text numberOfLines={1} style={styles.documentName}>
                {file.name}
              </Text>
              {!!file.createdAt && (
                <Text style={styles.documentDate}>
                  {new Date(file.createdAt).toLocaleDateString()}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          viewportHeight > 0 && {
            minHeight: viewportHeight + collapseDistance,
          },
        ]}
        onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
      >
        <ProfileHero
          testIDPrefix={PREFIX}
          title={displayName}
          imageUri={heroImage}
          fallbackColor={heroColor}
          initials={userInitials(displayName)}
          scrollY={scrollY}
          actions={heroActions}
          titleStyle={chatTextStyle(config?.typography?.profile?.title)}
          titleAccessory={
            isOwnProfile ? (
              <TouchableOpacity
                testID={`${PREFIX}-logout`}
                activeOpacity={0.7}
                style={styles.leaveButton}
                onPress={handleLogout}
              >
                <LeaveIcon color="#FFFFFF" width={18} height={18} />
                <Text style={styles.leaveLabel}>{t('action.leave')}</Text>
              </TouchableOpacity>
            ) : undefined
          }
        />

        <View style={styles.body}>
          <View style={styles.card}>
            <Text
              style={[
                styles.cardLabel,
                getElementFont(config, 'profileSectionLabel'),
              ]}
            >
              {t('modal.profile.about')}
            </Text>
            <Text style={styles.cardValue}>
              {description && description.length > 4
                ? description
                : t('modal.profile.noDescription')}
            </Text>
          </View>

          {tabs.length > 0 && (
            <View style={styles.card}>
              <View style={styles.tabsRow}>
                {tabs.map((tab) => {
                  const active = tab === activeTab;
                  const count =
                    tab === 'media'
                      ? media.length
                      : tab === 'documents'
                        ? documents.length
                        : 0;
                  return (
                    <TouchableOpacity
                      key={tab}
                      testID={`${PREFIX}-tab-${tab}`}
                      activeOpacity={0.7}
                      style={[
                        styles.tab,
                        active && { borderBottomColor: getIconColor(config) },
                      ]}
                      onPress={() => setActiveTab(tab)}
                    >
                      <Text
                        style={[
                          styles.tabLabel,
                          active && { color: getIconColor(config) },
                        ]}
                      >
                        {t(`modal.profile.${tab}`)}
                      </Text>
                      {count > 0 && (
                        <View
                          style={[
                            styles.tabBadge,
                            { backgroundColor: getIconColor(config) },
                          ]}
                        >
                          <Text style={styles.tabBadgeText}>{count}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
              {renderTabBody()}
            </View>
          )}

          {isOwnProfile && loadingFiles && files.length === 0 && (
            <ActivityIndicator testID={`${PREFIX}-files-loading`} />
          )}
        </View>
      </Animated.ScrollView>

      <ProfileTopBar
        testIDPrefix={PREFIX}
        title={displayName}
        imageUri={heroImage}
        fallbackColor={heroColor}
        initials={userInitials(displayName)}
        scrollY={scrollY}
        onBack={handleBackClick}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
      />
    </ModalContainerFullScreen>
  );
};

const styles = StyleSheet.create({
  screen: {
    position: 'relative',
    backgroundColor: '#F2F3F5',
  },
  scroll: {
    width: '100%',
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
  },
  body: {
    padding: 12,
    gap: 12,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  cardLabel: {
    color: '#8C8C8C',
    fontSize: 14,
  },
  cardValue: {
    color: '#141414',
    fontSize: 16,
    marginTop: 4,
  },
  leaveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  leaveLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFF2',
    marginBottom: 12,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 10,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#8C8C8C',
  },
  tabBadge: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  languageLabel: {
    fontSize: 16,
    color: '#141414',
  },
  check: {
    fontSize: 16,
    fontWeight: '700',
  },
  mediaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  mediaTile: {
    width: '31.8%',
    aspectRatio: 1,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#EFEFF2',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
  },
  documentText: {
    flex: 1,
  },
  documentName: {
    fontSize: 16,
    color: '#141414',
  },
  documentDate: {
    fontSize: 13,
    color: '#8C8C8C',
    marginTop: 2,
  },
});

export default UserProfileModal;
