/** @format */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Keyboard,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import * as ImagePicker from 'expo-image-picker';
import { useFileToken } from '../../../hooks/useFileToken';
import { appendFileToken } from '../../../helpers/secureFileUrl';
import { ModalContainerFullScreen } from '../styledModalComponents';
import { ProfileImagePlaceholder } from '../../MainComponents/ProfileImagePlaceholder';
import { RootState, getActiveRoom } from '../../../roomStore';
import { uploadFile } from '../../../networking/api-requests/auth.api';
import { useXmppClient } from '../../../context/xmppProvider';
import { deleteRoom, updateRoom } from '../../../roomStore/roomsSlice';
import Loader from '../../styled/Loader';
import {
  AddNewIcon,
  DeleteIcon,
  EditIcon,
  LeaveIcon,
  ReportIcon,
  SearchIcon,
} from '../../../assets/icons';
import { useChatSettingState } from '../../../hooks/useChatSettingState';
import { chatTextStyle } from '../../../helpers/typography';
import { getElementFont } from '../../../helpers/getElementFont';
import { getIconColor } from '../../../helpers/getIconColor';
import { deleteRoomMember } from '../../../networking/api-requests/rooms.api';
import { RoomMember } from '../../../types/models/room.model';
import { setActiveModal, setSelectedUser } from '../../../roomStore/chatSettingsSlice';
import { MODAL_TYPES } from '../../../helpers/constants/MODAL_TYPES';
import SelectUsersModal from '../SelectUsersModal/SelectUsersModal';
import { useToast } from '../../../context/ToastContext';
import { useT } from '../../../i18n/useT';
import DeleteChatModal from './DeleteChatModal';
import ReportChatModal from './ReportChatModal';
import {
  ProfileHero,
  ProfileTopBar,
  HeroAction,
  useHeaderMetrics,
} from '../ProfileHeader/ProfileHeader';
import ProfileMenu, { ProfileMenuItem } from '../ProfileHeader/ProfileMenu';

/**
 * Where the header should sit when search opens: tucked away at the
 * collapsed offset when the picture is still expanded, and left exactly
 * where it is when the user already scrolled it away.
 */
export const searchScrollTarget = (
  isCollapsed: boolean,
  collapseDistance: number
): number | null => (isCollapsed ? null : collapseDistance);

/** Two uppercase letters for a chat without a picture, same rule the
 * avatar placeholder uses for people. */
export const chatInitials = (name?: string | null): string => {
  const words = (name || '').trim().split(/\s+/).filter(Boolean);
  const letters = (words.length >= 2
    ? [words[0][0], words[1][0]]
    : [words[0]?.[0], words[0]?.[1]]
  ).filter((c) => !!c && /[\p{L}\p{N}]/u.test(c));
  return letters.join('').toUpperCase();
};

interface ChatProfileModalProps {
  handleCloseModal: any;
}

const ChatProfileModal: React.FC<ChatProfileModalProps> = ({
  handleCloseModal,
}) => {
  const t = useT();
  const [loading, setLoading] = useState<boolean>(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Measured, not guessed: this screen renders inside whatever frame the
  // host gives it (the demo app keeps its own tab bar above), so the
  // window height would overshoot.
  const [viewportHeight, setViewportHeight] = useState(0);

  const { showToast } = useToast();
  const dispatch = useDispatch();
  const { client } = useXmppClient();
  const { user: stateUser, config } = useChatSettingState();
  const activeRoom = useSelector((state: RootState) => getActiveRoom(state));
  const fileToken = useFileToken();

  // Drives both the hero's parallax and the collapsed bar's fade-in. One
  // shared value, written natively by the ScrollView.
  const scrollY = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<any>(null);
  const searchInputRef = useRef<TextInput>(null);
  const { collapseDistance } = useHeaderMetrics();
  // `scrollY` is driven natively, so its value can't be read back with
  // addListener. The Animated.event's `listener` still fires on the JS
  // side, which is enough to know which state the header is in.
  const [isCollapsed, setIsCollapsed] = useState(false);
  // Set when search collapsed the header itself, so only then does
  // dismissing search (or the keyboard) expand it again.
  const collapsedForSearchRef = useRef(false);

  // Pull live member list from the MUC when the modal opens — REST
  // hydration only fills the *count* (item.participants /
  // item.members.length); the actual roster comes from a `getRoomMembers`
  // IQ which onGetMembers in stanzaHandlers parses into `roomMembers`.
  useEffect(() => {
    if (client && activeRoom?.jid) {
      try {
        client.getRoomMembersStanza?.(activeRoom.jid);
      } catch {
        /* non-fatal */
      }
    }
  }, [client, activeRoom?.jid]);

  useEffect(() => {
    if (!activeRoom) {
      dispatch(setActiveModal(undefined));
    }
  }, [activeRoom, dispatch]);

  const onUpload = async () => {
    let loadingSet = false;
    try {
      setLoading(true);
      loadingSet = true;

      // expo-image-picker owns the permission prompt internally and
      // returns a `granted` flag. No separate react-native-permissions
      // round-trip needed.
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission required',
          'Photo library permission is needed to select images.',
          [
            {
              text: t('action.cancel'),
              onPress: () => setLoading(false),
              style: 'cancel',
            },
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
          ]
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled || !result.assets?.[0]) {
        return;
      }
      const asset = result.assets[0];
      const originalName = asset.fileName || asset.uri.split('/').pop();
      const fileObject = {
        uri: asset.uri,
        type: asset.mimeType || 'image/jpeg',
        name: originalName || `profile_${Date.now()}.jpg`,
      };

      const mediaData = new FormData();
      mediaData.append('files', fileObject as any);

      const uploadResult = await uploadFile(mediaData);
      const location = uploadResult?.data?.results?.[0]?.location;

      if (location) {
        client?.setRoomImageStanza(activeRoom?.jid || '', location, 'icon', 'none');
        dispatch(
          updateRoom({ jid: activeRoom?.jid || '', updates: { icon: location } })
        );

        showToast({
          id: Date.now().toString(),
          title: 'Success',
          message: 'Room image updated successfully',
          type: 'success',
        });
      }
    } catch (error: any) {
      if (error?.code === 'E_PICKER_CANCELLED' || error?.code === 'E_NO_CAMERA_PERMISSION') {
        console.log('User cancelled image selection');
        return;
      }

      console.error('File upload failed or location is missing:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to upload image',
        type: 'error',
      });
    } finally {
      if (loadingSet) {
        setLoading(false);
      }
    }
  };

  const onRemoveIcon = () => {
    client?.setRoomImageStanza(activeRoom?.jid || '', '', 'icon', 'none');
    dispatch(updateRoom({ jid: activeRoom?.jid || '', updates: { icon: null } }));
  };

  const handleDeleteUser = async (user: RoomMember) => {
    const userId = user.xmppUsername;
    try {
      await deleteRoomMember({
        roomId: activeRoom?.jid?.split('@')[0] || '',
        members: [userId],
      });

      dispatch(
        updateRoom({
          jid: activeRoom?.jid || '',
          updates: {
            roomMembers: activeRoom?.roomMembers?.filter(
              (member) => member.xmppUsername !== userId
            ),
          },
        })
      );

      showToast({
        id: Date.now().toString(),
        title: 'Success',
        message: `${userId} has been removed from the room.`,
        type: 'success',
      });
    } catch (error) {
      console.error('Failed to delete user:', error);
      showToast({
        id: Date.now().toString(),
        title: 'Error',
        message: 'Failed to delete user.',
        type: 'error',
      });
    }
  };

  const confirmRemoveMember = (user: RoomMember) => {
    Alert.alert(
      t('modal.chatProfile.removeMember'),
      `${user.firstName} ${user.lastName}`.trim(),
      [
        { text: t('action.cancel'), style: 'cancel' },
        {
          text: t('action.delete'),
          style: 'destructive',
          onPress: () => handleDeleteUser(user),
        },
      ]
    );
  };

  const handleUserAvatarClick = (user: RoomMember): void => {
    dispatch(setActiveModal(MODAL_TYPES.PROFILE));
    dispatch(
      setSelectedUser({
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: `${user.firstName} ${user.lastName}`,
        userJID: user?.xmppUsername,
        token: '',
        refreshToken: '',
      })
    );
  };

  // Leaving is XMPP-side (an unavailable presence to the MUC); dropping the
  // room from the store is what actually takes the user out of the chat in
  // the UI, and the `!activeRoom` effect above then closes this modal.
  const handleLeave = () => {
    Alert.alert(t('modal.leaveChat.title'), t('modal.leaveChat.description'), [
      { text: t('action.cancel'), style: 'cancel' },
      {
        text: t('action.leave'),
        style: 'destructive',
        onPress: () => {
          try {
            client?.leaveTheRoomStanza?.(activeRoom?.jid || '');
          } catch (error) {
            console.error('Failed to leave the room:', error);
          }
          dispatch(deleteRoom({ jid: activeRoom?.jid || '' }));
          handleCloseModal?.();
        },
      },
    ]);
  };

  const isModerator = activeRoom?.role === 'moderator';
  const canEditIcon =
    !config?.disableChatInfo?.disableIconEdit && activeRoom?.role !== 'participant';
  const canAddMembers = isModerator && activeRoom?.type === 'group';
  const canDeleteChat = isModerator && activeRoom?.type !== 'private';
  const hasIcon = !!activeRoom?.icon;

  const scrollHeaderTo = (y: number) =>
    scrollRef.current?.scrollTo?.({ y, animated: true });

  // Opening search from an expanded header tucks the picture away so the
  // results and the keyboard have room; from an already-collapsed header
  // it just opens the field. Whatever it collapsed, it puts back.
  const openMemberSearch = () => {
    const target = searchScrollTarget(isCollapsed, collapseDistance);
    if (target !== null) {
      collapsedForSearchRef.current = true;
      scrollHeaderTo(target);
    }
    setIsSearchOpen(true);
    setTimeout(() => searchInputRef.current?.focus(), 50);
  };

  const restoreHeader = () => {
    if (!collapsedForSearchRef.current) {return;}
    collapsedForSearchRef.current = false;
    scrollHeaderTo(0);
  };

  const closeMemberSearch = () => {
    setMemberQuery('');
    setIsSearchOpen(false);
    Keyboard.dismiss();
    restoreHeader();
  };

  // Putting the keyboard away is the other way out of search, so it
  // restores the header too — the field stays, results and all.
  useEffect(() => {
    if (!isSearchOpen) {return undefined;}
    const sub = Keyboard.addListener('keyboardDidHide', restoreHeader);
    return () => sub.remove();
  }, [isSearchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const heroActions: HeroAction[] = useMemo(
    () => [
      {
        key: 'search',
        label: t('action.search'),
        icon: (color: string) => <SearchIcon color={color} />,
        onPress: openMemberSearch,
      },
      {
        key: 'leave',
        label: t('action.leave'),
        icon: (color: string) => <LeaveIcon color={color} />,
        onPress: handleLeave,
      },
      {
        key: 'report',
        label: t('action.report'),
        icon: (color: string) => <ReportIcon color={color} />,
        onPress: () => setIsReportOpen(true),
      },
    ],
    [t, activeRoom?.jid] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // "…" menu. Edit is the chat picture — the only chat detail this SDK can
  // actually change (there is no update-chat endpoint for title/description),
  // so it is only offered when the picture is editable.
  const menuItems: ProfileMenuItem[] = useMemo(() => {
    const items: ProfileMenuItem[] = [];
    if (canEditIcon) {
      items.push({
        key: 'edit',
        label: t('action.edit'),
        icon: <EditIcon color="#141414" width={18} height={18} />,
        onPress: onUpload,
      });
      if (hasIcon) {
        items.push({
          key: 'remove-photo',
          label: t('modal.chatProfile.removePhoto'),
          icon: <DeleteIcon width={18} height={18} />,
          onPress: onRemoveIcon,
        });
      }
    }
    // The hero's Search button is off-screen once collapsed, so the menu
    // carries it — the design's collapsed menu does the same.
    if (isCollapsed) {
      items.push({
        key: 'search',
        label: t('action.search'),
        icon: <SearchIcon color="#141414" width={18} height={18} />,
        onPress: openMemberSearch,
      });
    }
    items.push({
      key: 'report',
      label: t('action.report'),
      icon: <ReportIcon color="#141414" width={18} height={18} />,
      onPress: () => setIsReportOpen(true),
    });
    if (canDeleteChat) {
      items.push({
        key: 'delete-and-leave',
        label: t('action.deleteAndLeave'),
        icon: <DeleteIcon width={18} height={18} />,
        destructive: true,
        onPress: () => setIsDeleteOpen(true),
      });
    }
    return items;
  }, [canEditIcon, canDeleteChat, hasIcon, isCollapsed, t]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeRoom) {
    return null;
  }

  const title = activeRoom.title || activeRoom.name;
  const memberCount = activeRoom.usersCnt ?? 0;
  const subtitle = t(
    memberCount === 1
      ? 'modal.chatProfile.memberCountSingular'
      : 'modal.chatProfile.memberCountPlural',
    { count: memberCount }
  );
  const heroImage = appendFileToken(activeRoom.icon, fileToken) || null;
  // A single flat colour behind the initials — the config's avatar colour
  // when set, otherwise the primary. (The old per-name hash colour is what
  // made the header read as two different greens next to the members' own
  // avatars.)
  const heroColor = config?.colors?.avatar || getIconColor(config);
  const members = activeRoom.roomMembers ?? [];
  const query = memberQuery.trim().toLowerCase();
  const visibleMembers = query
    ? members.filter((user) =>
        `${user.firstName ?? ''} ${user.lastName ?? ''}`
          .toLowerCase()
          .includes(query)
      )
    : members;

  return (
    <ModalContainerFullScreen style={styles.screen}>
      <Animated.ScrollView
        ref={scrollRef}
        style={styles.scroll}
        // The collapsed state has to be reachable even when the member list
        // is short: without this the content was shorter than the viewport,
        // so the scroll had nowhere to go and simply bounced back.
        contentContainerStyle={[
          styles.scrollContent,
          viewportHeight > 0 && {
            minHeight: viewportHeight + collapseDistance,
          },
        ]}
        onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          {
            useNativeDriver: true,
            listener: (e: any) => {
              const y = e?.nativeEvent?.contentOffset?.y ?? 0;
              setIsCollapsed(y >= collapseDistance - 8);
            },
          }
        )}
      >
        <ProfileHero
          title={title}
          subtitle={subtitle}
          imageUri={heroImage}
          fallbackColor={heroColor}
          initials={chatInitials(title)}
          scrollY={scrollY}
          actions={heroActions}
          titleStyle={chatTextStyle(config?.typography?.profile?.title)}
          subtitleStyle={getElementFont(config, 'profileStatus')}
        />

        <View style={styles.body}>
          {!config?.disableChatInfo?.disableDescription && (
            <View style={styles.card}>
              <Text style={[styles.cardLabel, getElementFont(config, 'profileSectionLabel')]}>
                {t('modal.chatProfile.description')}
              </Text>
              <Text style={styles.cardValue}>{activeRoom.description || '—'}</Text>
            </View>
          )}

          {!config?.disableChatInfo?.disableType && (
            <View style={styles.card}>
              <Text style={[styles.cardLabel, getElementFont(config, 'profileSectionLabel')]}>
                {t('modal.chatProfile.chatType')}
              </Text>
              <Text style={styles.cardValue}>{activeRoom.type || '—'}</Text>
            </View>
          )}

          {!config?.disableChatInfo?.hideMembers && (
            <View style={styles.card}>
              {canAddMembers && (
                <SelectUsersModal
                  trigger={(open) => (
                    <TouchableOpacity
                      testID="chat-profile-add-members"
                      activeOpacity={0.7}
                      style={styles.addMembersRow}
                      onPress={open}
                    >
                      <AddNewIcon color={getIconColor(config)} />
                      <Text style={styles.addMembersLabel}>
                        {t('modal.chatProfile.addMembers')}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              )}

              <Text
                style={[
                  styles.cardLabel,
                  getElementFont(config, 'profileSectionLabel'),
                ]}
              >
                {t('modal.chatProfile.membersLabel', { count: memberCount })}
              </Text>

              {isSearchOpen && (
                <View style={styles.searchRow}>
                  <SearchIcon color="#8C8C8C" width={18} height={18} />
                  <TextInput
                    testID="chat-profile-member-search"
                    ref={searchInputRef}
                    style={styles.searchInput}
                    value={memberQuery}
                    onChangeText={setMemberQuery}
                    placeholder={t('search.members')}
                    placeholderTextColor="#8C8C8C"
                    autoCorrect={false}
                    returnKeyType="search"
                  />
                  <TouchableOpacity
                    testID="chat-profile-search-close"
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    onPress={closeMemberSearch}
                  >
                    <Text style={styles.searchClose}>×</Text>
                  </TouchableOpacity>
                </View>
              )}

              {loading ? (
                <Loader />
              ) : visibleMembers.length === 0 ? (
                <Text testID="chat-profile-members-empty" style={styles.emptyMembers}>
                  {members.length === 0
                    ? t('modal.chatProfile.membersUnavailable')
                    : t('search.noResults')}
                </Text>
              ) : (
                visibleMembers.map((user, index) => {
                  const banned = user.ban_status === 'banned';
                  const roleLabel =
                    user.role && user.role !== 'none' && user.role !== 'participant'
                      ? user.role
                      : null;
                  return (
                    <View
                      key={user.xmppUsername}
                      style={[styles.memberRow, index > 0 && styles.memberDivider]}
                    >
                      <Pressable
                        style={styles.memberMain}
                        // `disableChatInfo.disableMemberTap` blocks the tap
                        // entirely so the user-profile popup never opens.
                        // `disableMemberProfileActions` only hid the action
                        // buttons INSIDE that popup, leaving the popup itself
                        // to open on tap — this gate closes the door.
                        // Customer-reported #16.
                        onPress={
                          config?.disableChatInfo?.disableMemberTap
                            ? undefined
                            : () => handleUserAvatarClick(user)
                        }
                        disabled={!!config?.disableChatInfo?.disableMemberTap}
                      >
                        <ProfileImagePlaceholder
                          name={`${user.firstName} ${user.lastName}`}
                          size={40}
                        />
                        <View style={styles.memberText}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.memberName,
                              chatTextStyle(config?.typography?.profile?.memberName),
                            ]}
                          >
                            {user.firstName} {user.lastName}
                          </Text>
                          {!!user.last_active && (
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.memberStatus,
                                getElementFont(config, 'profileSectionLabel'),
                              ]}
                            >
                              {new Date(user.last_active * 1000).toLocaleString()}
                            </Text>
                          )}
                        </View>
                      </Pressable>

                      {(banned || roleLabel) && (
                        <Text
                          style={[styles.memberRole, banned && styles.memberBanned]}
                        >
                          {banned ? t('status.banned') : roleLabel}
                        </Text>
                      )}

                      {isModerator &&
                        activeRoom.type !== 'private' &&
                        stateUser.xmppUsername !== user.xmppUsername && (
                          <TouchableOpacity
                            testID={`chat-profile-remove-${user.xmppUsername}`}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.memberRemove}
                            onPress={() => confirmRemoveMember(user)}
                          >
                            <DeleteIcon width={20} height={20} />
                          </TouchableOpacity>
                        )}
                    </View>
                  );
                })
              )}
            </View>
          )}
        </View>
      </Animated.ScrollView>

      <ProfileTopBar
        title={title}
        subtitle={subtitle}
        imageUri={heroImage}
        fallbackColor={heroColor}
        initials={chatInitials(title)}
        scrollY={scrollY}
        onBack={handleCloseModal}
        titleStyle={chatTextStyle(config?.typography?.profile?.screenTitle)}
        menu={<ProfileMenu items={menuItems} />}
      />

      <DeleteChatModal
        isModalOpen={isDeleteOpen}
        setIsModalOpen={setIsDeleteOpen}
      />
      <ReportChatModal
        visible={isReportOpen}
        onClose={() => setIsReportOpen(false)}
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
  addMembersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 14,
    marginBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFF2',
  },
  addMembersLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#141414',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F2F3F5',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#141414',
    padding: 0,
  },
  searchClose: {
    fontSize: 22,
    lineHeight: 24,
    color: '#8C8C8C',
  },
  emptyMembers: {
    opacity: 0.6,
    textAlign: 'center',
    paddingVertical: 8,
    color: '#141414',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  memberDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EFEFF2',
  },
  memberMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberText: {
    flex: 1,
  },
  memberName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#141414',
  },
  memberStatus: {
    fontSize: 13,
    color: '#8C8C8C',
    marginTop: 2,
  },
  memberRole: {
    fontSize: 13,
    color: '#8C8C8C',
    marginLeft: 8,
  },
  memberBanned: {
    color: '#E53935',
  },
  memberRemove: {
    marginLeft: 12,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ChatProfileModal;
