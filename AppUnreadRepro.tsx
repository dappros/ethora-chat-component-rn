/**
 * AppUnreadRepro — mirrors the integrator's EXACT wiring so the unread
 * badge can be tested apples-to-apples:
 *
 *   <XmppProvider config={{ initBeforeLoad, jwtLogin, refreshTokens, ... }}>
 *     <Tabs>                                   // Home (default) + Messages
 *       MessagesTabIcon → useUnread() badge
 *       Messages screen → <Chat roomJID isVisible={isFocused} disableRooms />
 *     </Tabs>
 *   </XmppProvider>
 *
 * The testbed has no react-navigation, so a minimal 2-tab switcher provides
 * the SAME semantics: both screens stay MOUNTED and `isVisible` follows the
 * focused tab (=== React Navigation's `useIsFocused`). So you can sit on the
 * Home tab and watch the Messages badge light up when the other account
 * sends a message — exactly the bug we fixed.
 *
 * Home shows the FULL useUnread() output (hasUnread / totalCount /
 * unreadByRoom) and a Logout/Login control.
 *
 * Reproduces the integrator's DOUBLE-provider setup on purpose (outer
 * <XmppProvider> + the <Chat>'s own internal provider). Creds come from the
 * same AsyncStorage bag the seed scripts write (`@apploginchatsrn/creds`).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  KeyboardProvider,
  KeyboardAvoidingView as KCAvoidingView,
} from 'react-native-keyboard-controller';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';

import { XmppProvider } from './src/context/xmppProvider';
import { ReduxWrapper as Chat } from './src/components/MainComponents/ReduxWrapper';
import { useUnread } from './src/hooks/useUnreadMessagesCounter';
import { logoutService } from './src/hooks/useLogout';
import { store as chatStore } from './src/roomStore';
import { msgSortableMs } from './src/roomStore/roomsSlice';
import type { IConfig, IRoom } from './src/types/types';

const CREDS_KEY = '@apploginchatsrn/creds';
const PRIMARY = '#5E3FDE';
const SECONDARY = '#E1E4FE';

type Creds = {
  jwt: string;
  baseUrl: string;
  xmppHost: string;
  xmppDevServer: string;
  conference: string;
};

const shortJid = (jid: string) => jid.split('@')[0].slice(-12);
const formatTimestamp = (ts?: number) => {
  if (!ts || !Number.isFinite(ts)) return '0 / unset';
  return `${ts} (${new Date(ts).toLocaleTimeString()})`;
};

const latestMessageLabel = (room?: IRoom) => {
  const messages = room?.messages || [];
  const last = messages[messages.length - 1] as any;
  if (!last) return 'none';
  return `${last.id || 'no-id'} · ${last.date || last.messageTimestampMs || 'no-date'}`;
};

// ───────────────────────── DIAGNOSTICS ─────────────────────────
// Everything below emits single-line, greppable JSON to the Metro
// console under the `[UNREAD-DIAG]` tag so this whole transcript can be
// copied to another dev. Each line is stamped with `+<seconds>` since
// JS start, which makes the "offline messages take ~20s to show up on
// reopen" latency obvious just by reading the timestamps.
const DIAG = '[UNREAD-DIAG]';
const APP_START_MS = Date.now();
const sinceStart = () => `+${((Date.now() - APP_START_MS) / 1000).toFixed(2)}s`;
const tsLabel = (ms?: number) =>
  ms && Number.isFinite(ms) ? `${ms} (${new Date(ms).toISOString()})` : '0/unset';

// Ring buffer of the recent diag lines so the on-screen "Copy
// diagnostics" button can dump the transcript to the clipboard for
// sharing with another dev (no Metro terminal access needed).
const DIAG_BUFFER: string[] = [];
const DIAG_BUFFER_MAX = 500;

const diag = (event: string, data?: Record<string, unknown>) => {
  let line: string;
  try {
    line = `${DIAG} ${sinceStart()} ${event} ${JSON.stringify(data ?? {})}`;
  } catch {
    line = `${DIAG} ${sinceStart()} ${event} <unserializable>`;
  }
  console.log(line);
  DIAG_BUFFER.push(line);
  if (DIAG_BUFFER.length > DIAG_BUFFER_MAX) DIAG_BUFFER.shift();
};

// Snapshot of one room's unread-relevant state, plus a LOCALLY-computed
// "expected" unread (messages strictly newer than lastViewed). If
// `unreadMessages` and `msgsNewerThanLastViewed` disagree, the SDK's
// own-message filter / `lastViewedTimestamp > 0` gate is the reason —
// that gap is the single most useful signal for diagnosing the badge.
const snapshotRoom = (jid?: string) => {
  if (!jid) return null;
  const state: any = chatStore.getState();
  const room: IRoom | undefined = state.rooms?.rooms?.[jid];
  if (!room) return null;
  const msgs: any[] = room.messages || [];
  const lv = room.lastViewedTimestamp || 0;
  const selfXmpp = String(state.chatSettingStore?.user?.xmppUsername || '').toLowerCase();
  let newestMs = 0;
  let newerThanLastViewed = 0;
  let newerExcludingOwn = 0;
  for (const m of msgs) {
    if (!m || m.id === 'delimiter-new' || m.pending) continue;
    const ms = msgSortableMs(m);
    if (ms > newestMs) newestMs = ms;
    if (lv > 0 && ms > lv) {
      newerThanLastViewed += 1;
      const sender = String(
        m?.user?.xmppUsername || m?.user?.userJID || m?.user?.id || ''
      ).toLowerCase();
      const isOwn = selfXmpp && sender.includes(selfXmpp.split('@')[0]);
      if (!isOwn) newerExcludingOwn += 1;
    }
  }
  const last: any = msgs[msgs.length - 1];
  return {
    messages: msgs.length,
    unreadMessages: room.unreadMessages || 0,
    lastViewed: tsLabel(lv),
    unreadBaseline: tsLabel(room.unreadBaselineTimestamp),
    serverMarker: tsLabel(state.rooms?.privateStoreMarkers?.[jid]),
    newestMessageMs: tsLabel(newestMs),
    msgsNewerThanLastViewed: newerThanLastViewed,
    msgsNewerExcludingOwn: newerExcludingOwn,
    latestId: last?.id ?? null,
    latestDate: last?.date ?? last?.messageTimestampMs ?? null,
    isLoading: !!room.isLoading,
    historyPreloadState: (room as any).historyPreloadState ?? null,
  };
};

// Sum of every room's unreadMessages — i.e. exactly what the tab badge
// shows via useUnread().
const totalUnread = () => {
  const rooms = chatStore.getState().rooms?.rooms || {};
  return Object.values(rooms).reduce(
    (n, r: any) => n + (r?.unreadMessages || 0),
    0
  );
};

// Subscribes to the store and logs a structured event ONLY when the
// tracked fields actually change (so it's signal, not spam). Mounted
// once at the top of the tree so it runs on BOTH tabs — including while
// the Messages tab (and <Chat>) is unmounted, which is exactly when the
// badge is supposed to update from the app-wide XMPP connection.
const UnreadDiagnosticsLogger: React.FC<{
  roomJID?: string;
  chatMounted: boolean;
  tab: string;
}> = ({ roomJID, chatMounted, tab }) => {
  const prevFingerprint = useRef<string>('');
  useEffect(() => {
    const emit = (reason: string) => {
      const state: any = chatStore.getState();
      const roomCount = Object.keys(state.rooms?.rooms || {}).length;
      const room = snapshotRoom(roomJID);
      const fingerprint = JSON.stringify({
        roomCount,
        active: state.rooms?.activeRoomJID || null,
        visible: state.rooms?.visibleRoomJID || null,
        room,
        total: totalUnread(),
        syncing: !!state.rooms?.isUnreadSyncing,
      });
      if (reason === 'store' && fingerprint === prevFingerprint.current) return;
      prevFingerprint.current = fingerprint;
      diag('state', {
        reason,
        tab,
        chatMounted,
        badgeTotalUnread: totalUnread(),
        // NEW: useUnread().isLoading surface — true while the count is
        // still settling (history-preload sync in progress).
        isLoading: !!state.rooms?.isUnreadSyncing || !!state.rooms?.isLoading,
        isUnreadSyncing: !!state.rooms?.isUnreadSyncing,
        roomCount,
        activeRoomJID: state.rooms?.activeRoomJID || null,
        visibleRoomJID: state.rooms?.visibleRoomJID || null,
        selectedRoomJID: roomJID || null,
        userLoaded: !!state.chatSettingStore?.user?.xmppUsername,
        room,
      });
    };
    emit('mount');
    const unsub = chatStore.subscribe(() => emit('store'));
    return unsub;
  }, [roomJID, chatMounted, tab]);
  return null;
};

// Builds the shareable text blob: a header snapshot + the recent event
// buffer. Used by the "Copy diagnostics" button.
const buildDiagnosticsText = (roomJID?: string): string => {
  const state: any = chatStore.getState();
  const header = [
    `=== UNREAD DIAGNOSTICS @ ${new Date().toISOString()} (${sinceStart()}) ===`,
    `platform: ${Platform.OS}`,
    `badgeTotalUnread: ${totalUnread()}`,
    `activeRoomJID: ${state.rooms?.activeRoomJID || 'none'}`,
    `visibleRoomJID: ${state.rooms?.visibleRoomJID || 'none'}`,
    `selectedRoomJID: ${roomJID || 'none'}`,
    `userLoaded: ${!!state.chatSettingStore?.user?.xmppUsername}`,
    `xmppOnline: ${!!state.chatSettingStore?.client?.client && state.chatSettingStore?.client?.client?.status === 'online'}`,
    `selectedRoom: ${JSON.stringify(snapshotRoom(roomJID))}`,
    `--- last ${DIAG_BUFFER.length} [UNREAD-DIAG] events ---`,
  ];
  return [...header, ...DIAG_BUFFER].join('\n');
};

// Taps directly into the underlying @xmpp/client `stanza` stream so we
// can see whether an incoming groupchat message even REACHES the device
// — and, critically, whether it carries the `<data senderJID=…>` element
// that the SDK's onMessage handler requires (it drops messages without
// it). `willBeDroppedByGuard:true` means the message arrived but the SDK
// will silently ignore it → no badge update. Mounted once, app-wide.
const RawStanzaLogger: React.FC = () => {
  const attachedRef = useRef<any>(null);
  useEffect(() => {
    const handler = (stanza: any) => {
      try {
        if (!stanza?.is?.('message')) return;
        if (stanza.attrs?.type !== 'groupchat') return;
        const dataEl = stanza.getChild?.('data');
        const bodyEl = stanza.getChild?.('body');
        let body: string | null = null;
        try {
          body = bodyEl?.text ? String(bodyEl.text()).slice(0, 60) : null;
        } catch {}
        const senderJID = dataEl?.attrs?.senderJID || null;
        diag('raw-stanza', {
          from: stanza.attrs?.from || null,
          id: stanza.attrs?.id || null,
          hasBody: !!bodyEl,
          body,
          hasDataElement: !!dataEl,
          senderJID,
          // The SDK's stanzaHandlers.onMessage early-returns when
          // data.senderJID is missing — so this predicts a silent drop.
          willBeDroppedByGuard: !senderJID,
        });
      } catch {}
    };
    const tryAttach = () => {
      const wrapper: any = chatStore.getState().chatSettingStore?.client;
      const raw: any = wrapper?.client; // underlying @xmpp/client
      if (!raw || attachedRef.current === raw) return;
      if (attachedRef.current?.off) {
        try { attachedRef.current.off('stanza', handler); } catch {}
      }
      attachedRef.current = raw;
      try {
        raw.on('stanza', handler);
        diag('raw-listener-attached', {});
      } catch (e) {
        diag('raw-listener-error', { err: String(e) });
      }
    };
    tryAttach();
    const unsub = chatStore.subscribe(tryAttach);
    return () => {
      unsub();
      if (attachedRef.current?.off) {
        try { attachedRef.current.off('stanza', handler); } catch {}
      }
    };
  }, []);
  return null;
};

// Best-effort decode of the `userId` out of the client JWT so each device
// shows WHO it is logged in as (handy when testing two sims side by side).
const jwtUserId = (jwt: string): string => {
  try {
    const part = jwt.split('.')[1];
    if (!part) return '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof atob === 'function'
        ? atob(b64)
        : (globalThis as any).Buffer?.from(b64, 'base64').toString('utf8');
    const id = JSON.parse(json)?.data?.userId || '';
    return id ? String(id).slice(0, 8) : '';
  } catch {
    return '';
  }
};

// Reads the library's useUnread() EXACTLY like the integrator, and renders a
// count badge on the tab icon.
const MessagesTabIcon: React.FC<{ active: boolean }> = ({ active }) => {
  const { hasUnread, totalCount } = useUnread();
  return (
    <View style={styles.tabIconWrap}>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>
        Messages
      </Text>
      {hasUnread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {totalCount > 99 ? '99+' : totalCount}
          </Text>
        </View>
      ) : null}
    </View>
  );
};

// The full useUnread() surface, live.
const UnreadPanel: React.FC = () => {
  const { hasUnread, totalCount, unreadByRoom, isLoading } = useUnread();
  const entries = Object.entries(unreadByRoom || {});
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>useUnread()</Text>
      <Text style={styles.panelRow}>
        hasUnread: <Text style={styles.panelVal}>{String(hasUnread)}</Text>
      </Text>
      <Text style={styles.panelRow}>
        totalCount: <Text style={styles.panelVal}>{totalCount}</Text>
        {isLoading ? <Text style={styles.panelVal}>  ⏳ loading…</Text> : null}
      </Text>
      <Text style={styles.panelRow}>
        isLoading: <Text style={styles.panelVal}>{String(isLoading)}</Text>
      </Text>
      <Text style={styles.panelRow}>unreadByRoom:</Text>
      {entries.length === 0 ? (
        <Text style={styles.panelMuted}>   (none)</Text>
      ) : (
        entries.map(([jid, n]) => (
          <Text key={jid} style={styles.panelMuted}>
            {'   '}
            {shortJid(jid)}: <Text style={styles.panelVal}>{n}</Text>
          </Text>
        ))
      )}
    </View>
  );
};

const StoreDebugPanel: React.FC<{
  isMessagesVisible: boolean;
  roomJID?: string;
}> = ({ isMessagesVisible, roomJID }) => {
  const roomsState = useSyncExternalStore(
    subscribeRooms,
    () => chatStore.getState().rooms
  );
  const unread = useUnread();
  const roomsMap = roomsState.rooms || {};
  const selectedRoom = roomJID ? roomsMap[roomJID] : undefined;
  const roomEntries = Object.entries(roomsMap);
  const visibleRoomJID = roomsState.visibleRoomJID;
  const activeRoomJID = roomsState.activeRoomJID;

  const diagnosis = useMemo(() => {
    if (!roomJID) return 'Waiting for room selection.';
    if (!selectedRoom) return 'Selected room is not loaded in the SDK store yet.';
    if (!isMessagesVisible && visibleRoomJID === roomJID) {
      return 'Hidden tab is still marked visible. isVisible=false is not clearing visibleRoomJID.';
    }
    if (!isMessagesVisible && !(selectedRoom.lastViewedTimestamp > 0)) {
      return 'Room is hidden but lastViewedTimestamp is unset. unreadMiddleware will keep unread at 0.';
    }
    if ((selectedRoom.unreadMessages || 0) > 0 && unread.totalCount === 0) {
      return 'Room unread is non-zero but useUnread total is 0. Suspect duplicate package/store in host app.';
    }
    if (!isMessagesVisible && (selectedRoom.messages?.length || 0) > 0) {
      return 'Hidden state looks valid. Send a new message from the other account and watch unreadMessages.';
    }
    return 'No obvious mismatch in the current snapshot.';
  }, [
    isMessagesVisible,
    roomJID,
    selectedRoom,
    unread.totalCount,
    visibleRoomJID,
  ]);

  // NOTE: structured console logging now lives in <UnreadDiagnosticsLogger>
  // (tag `[UNREAD-DIAG]`), which runs on BOTH tabs. This panel is the
  // on-screen mirror only.

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Store debug</Text>
      <Text style={styles.panelRow}>
        tab visible: <Text style={styles.panelVal}>{String(isMessagesVisible)}</Text>
      </Text>
      <Text style={styles.panelRow}>
        activeRoomJID:{' '}
        <Text style={styles.panelVal}>
          {activeRoomJID ? shortJid(activeRoomJID) : 'none'}
        </Text>
      </Text>
      <Text style={styles.panelRow}>
        visibleRoomJID:{' '}
        <Text style={styles.panelVal}>
          {visibleRoomJID ? shortJid(visibleRoomJID) : 'none'}
        </Text>
      </Text>
      <Text style={styles.panelRow}>
        selected room:{' '}
        <Text style={styles.panelVal}>
          {roomJID ? shortJid(roomJID) : 'none'}
        </Text>
      </Text>
      <Text style={styles.diagnosis}>{diagnosis}</Text>

      {roomEntries.length === 0 ? (
        <Text style={styles.panelMuted}>   no rooms loaded</Text>
      ) : (
        roomEntries.map(([jid, room]) => (
          <View key={jid} style={styles.roomDebugRow}>
            <Text style={styles.panelMuted}>
              {jid === roomJID ? '* ' : '  '}
              {shortJid(jid)}
            </Text>
            <Text style={styles.panelMuted}>
              unread:{' '}
              <Text style={styles.panelVal}>{room.unreadMessages || 0}</Text>
              {'  '}messages:{' '}
              <Text style={styles.panelVal}>{room.messages?.length || 0}</Text>
            </Text>
            <Text style={styles.panelMuted}>
              lastViewed: {formatTimestamp(room.lastViewedTimestamp)}
            </Text>
            <Text style={styles.panelMuted}>
              latest: {latestMessageLabel(room)}
            </Text>
          </View>
        ))
      )}
    </View>
  );
};

const HomeScreen: React.FC<{
  who: string;
  roomCount: number;
  roomJID?: string;
  isMessagesVisible: boolean;
}> = ({ who, roomCount, roomJID, isMessagesVisible }) => {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(buildDiagnosticsText(roomJID));
      diag('diagnostics-copied', { events: DIAG_BUFFER.length });
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      diag('diagnostics-copy-failed', { err: String(e) });
    }
  }, [roomJID]);

  return (
    <ScrollView contentContainerStyle={styles.homeScroll}>
      <Text style={styles.h1}>Home</Text>
      <Text style={styles.who}>
        {Platform.OS.toUpperCase()} · user {who || '—'}
      </Text>
      <Text style={styles.diag}>
        rooms loaded: {roomCount}
        {roomJID ? `  ·  active: ${shortJid(roomJID)}` : ''}
      </Text>

      <UnreadPanel />
      <StoreDebugPanel roomJID={roomJID} isMessagesVisible={isMessagesVisible} />

      <Pressable style={styles.copyBtn} onPress={onCopy}>
        <Text style={styles.copyBtnText}>
          {copied ? '✓ Copied to clipboard' : '⧉ Copy diagnostics'}
        </Text>
      </Pressable>

      <Text style={styles.muted}>
        Stay on this tab and have the OTHER account send a message — the
        Messages badge + the panel above should increment (the outer
        XmppProvider receives it via initBeforeLoad). Open Messages to clear it.
        {'\n'}Full structured logs print to Metro under [UNREAD-DIAG]; the
        button copies the recent transcript to share.
      </Text>
    </ScrollView>
  );
};

// Subscribe to the singleton store to auto-pick a room for <Chat roomJID>.
const subscribeRooms = (cb: () => void) => chatStore.subscribe(cb);
const getRooms = () => chatStore.getState().rooms.rooms as Record<string, IRoom>;

const AppUnreadRepro: React.FC = () => {
  const [creds, setCreds] = useState<Creds | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'home' | 'messages'>('home');
  const [session, setSession] = useState<'in' | 'out'>('in');
  const [busy, setBusy] = useState(false);
  const insets = useSafeAreaInsets();

  // ── lifecycle diagnostics ──────────────────────────────────────────
  // App mount + foreground/background transitions. The cold-start line
  // marks t0 for the "how long until offline messages show up" measure.
  useEffect(() => {
    diag('app-mounted', { platform: Platform.OS });
    const sub = AppState.addEventListener('change', (next) => {
      diag('appstate', { appState: next, badgeTotalUnread: totalUnread() });
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CREDS_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          setCreds({
            jwt: p.jwt || '',
            baseUrl: p.baseUrl || '',
            xmppHost: p.xmppHost || '',
            xmppDevServer: p.xmppDevServer || '',
            conference: p.conference || '',
          });
        }
      } catch {
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // Auto-pick the first loaded room for the single-room Chat.
  const rooms = useSyncExternalStore(subscribeRooms, getRooms);
  const roomJID = useMemo(() => Object.keys(rooms || {})[0], [rooms]);

  // Tab switches = <Chat> mount (Messages) / unmount (Home). This is the
  // boundary the integrator cares about: while on Home, <Chat> is gone
  // and the badge must update purely from the outer XmppProvider.
  useEffect(() => {
    diag('tab-change', {
      tab: activeTab,
      chatMounts: activeTab === 'messages',
      selectedRoomJID: roomJID || null,
      badgeTotalUnread: totalUnread(),
    });
  }, [activeTab, roomJID]);

  // First time the target room shows up in the store (after initBeforeLoad).
  const announcedRoomRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (roomJID && announcedRoomRef.current !== roomJID) {
      announcedRoomRef.current = roomJID;
      diag('room-resolved', { roomJID, room: snapshotRoom(roomJID) });
    }
  }, [roomJID]);

  const outerConfig = useMemo<IConfig | null>(() => {
    if (!creds?.jwt) return null;
    return {
      customAppToken: creds.jwt,
      baseUrl: creds.baseUrl,
      xmppSettings: {
        devServer: creds.xmppDevServer,
        host: creds.xmppHost,
        conference: creds.conference,
      },
      jwtLogin: { enabled: true, token: creds.jwt },
      refreshTokens: { enabled: true },
      initBeforeLoad: true,
      clearStoreBeforeInit: false,
      newArch: true,
    } as IConfig;
  }, [creds]);

  const chatConfig = useMemo<IConfig | null>(() => {
    if (!outerConfig) return null;
    return {
      ...outerConfig,
      disableRooms: true,
      colors: { primary: PRIMARY, secondary: SECONDARY },
      disableProfilesInteractions: true,
      disableChatHeaderBurgerMenuIcon: true,
      // Disable the built-in keyboard handling on BOTH platforms:
      //  • iOS  → the OUTER KeyboardAvoidingView (below) lifts the input.
      //  • Android → no outer KAV / no KeyboardProvider, so the manifest's
      //    windowSoftInputMode="adjustResize" lifts the input in a SINGLE
      //    native window resize. (KeyboardStickyView over-lifted the input
      //    to the top here because this testbed isn't edge-to-edge, so the
      //    OS resize + the sticky translate stacked.)
      disableKeyboardAvoidingView: true,
      keyboardVerticalOffset: 0,
    } as IConfig;
  }, [outerConfig]);

  const doLogout = useCallback(async () => {
    diag('logout-start', { badgeTotalUnread: totalUnread() });
    setBusy(true);
    try {
      await logoutService.performLogout();
    } catch {}
    setActiveTab('home');
    setSession('out');
    setBusy(false);
    diag('logout-done', { badgeTotalUnread: totalUnread() });
  }, []);

  const doLogin = useCallback(() => {
    diag('login', {});
    setSession('in');
  }, []);

  if (!loaded) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  if (!outerConfig || !chatConfig) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.h1}>No seeded creds</Text>
        <Text style={styles.muted}>
          Expected a JWT bag at AsyncStorage key {CREDS_KEY}. Run the seed
          script for this platform, then reload.
        </Text>
      </SafeAreaView>
    );
  }

  const who = jwtUserId(creds!.jwt);

  // Logged out: XmppProvider is UNMOUNTED (connection torn down). Login
  // remounts it → initBeforeLoad re-runs against the still-seeded creds.
  if (session === 'out') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.h1}>Logged out</Text>
        <Text style={styles.who}>
          {Platform.OS.toUpperCase()} · user {who}
        </Text>
        <Text style={styles.muted}>
          XMPP disconnected, redux + persisted state cleared. Tap Login to
          re-run initBeforeLoad.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={doLogin}>
          <Text style={styles.primaryBtnText}>Log in</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const isMessages = activeTab === 'messages';

  const chatNode = roomJID ? (
    <Chat roomJID={roomJID} isVisible={isMessages} config={chatConfig} />
  ) : (
    <View style={styles.center}>
      <ActivityIndicator color={PRIMARY} />
      <Text style={styles.muted}>Loading rooms via initBeforeLoad…</Text>
    </View>
  );

  // iOS: outer KeyboardAvoidingView owns the lift (built-in is disabled in
  // chatConfig). The offset = everything above the chat on screen (the
  // top safe-area inset + the ~40px identity/Logout bar). ▼▼ TUNE THIS ONE
  // NUMBER on the iOS sim if the input sits too high/low vs the keyboard.
  const IOS_KB_OFFSET = insets.top + 52;
  const messagesPane =
    Platform.OS === 'ios' ? (
      <KCAvoidingView
        style={styles.flex}
        behavior="padding"
        keyboardVerticalOffset={IOS_KB_OFFSET}
      >
        {chatNode}
      </KCAvoidingView>
    ) : (
      chatNode
    );

  const tree = (
    <XmppProvider config={outerConfig}>
      {/* Always-on structured logger — runs on both tabs (incl. while
          <Chat> is unmounted on Home). Emits `[UNREAD-DIAG]` lines. */}
      <UnreadDiagnosticsLogger
        roomJID={roomJID}
        chatMounted={isMessages}
        tab={activeTab}
      />
      <RawStanzaLogger />
      <SafeAreaView style={styles.flex} edges={['top']}>
        {/* Top bar: identity + logout */}
        <View style={styles.topBar}>
          <Text style={styles.topBarText}>
            {Platform.OS.toUpperCase()} · {who}
          </Text>
          <Pressable
            style={styles.logoutBtn}
            onPress={doLogout}
            disabled={busy}
          >
            <Text style={styles.logoutText}>
              {busy ? '…' : 'Logout'}
            </Text>
          </Pressable>
        </View>

        {/* Home stays mounted; hidden (not unmounted) when inactive. */}
        <View style={[styles.flex, isMessages && styles.hidden]}>
          <HomeScreen
            who={who}
            roomCount={Object.keys(rooms || {}).length}
            roomJID={roomJID}
            isMessagesVisible={isMessages}
          />
        </View>

        {/* Integrator parity: <Chat> MOUNTS only when the Messages tab is
            open and UNMOUNTS on leave (the host's real React-Navigation
            wiring), instead of staying mounted behind display:none. The
            outer XmppProvider keeps XMPP connected app-wide for the badge. */}
        {isMessages ? <View style={styles.flex}>{messagesPane}</View> : null}
      </SafeAreaView>

      {/* Bottom tab bar */}
      <View style={styles.tabBar}>
        <Pressable style={styles.tabBtn} onPress={() => setActiveTab('home')}>
          <Text
            style={[styles.tabLabel, !isMessages && styles.tabLabelActive]}
          >
            Home
          </Text>
        </Pressable>
        <Pressable
          style={styles.tabBtn}
          onPress={() => setActiveTab('messages')}
        >
          <MessagesTabIcon active={isMessages} />
        </Pressable>
      </View>
    </XmppProvider>
  );

  // iOS needs a KeyboardProvider ABOVE the outer KeyboardAvoidingView. On
  // Android the <Chat>'s own internal KeyboardProvider drives the sticky
  // input, so we don't add a second (nested) one here.
  return Platform.OS === 'ios' ? (
    <KeyboardProvider>{tree}</KeyboardProvider>
  ) : (
    tree
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#fff' },
  hidden: { display: 'none' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#fff',
  },
  homeScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 10,
  },
  h1: { fontSize: 22, fontWeight: '700', color: '#141414' },
  who: { fontSize: 14, fontWeight: '600', color: PRIMARY },
  diag: { fontSize: 13, fontWeight: '600', color: '#16A34A' },
  muted: { fontSize: 13, color: '#71717A', textAlign: 'center', lineHeight: 18 },

  // useUnread() panel
  panel: {
    alignSelf: 'stretch',
    marginHorizontal: 8,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#F4F4F8',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    gap: 3,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#141414',
    marginBottom: 4,
  },
  panelRow: { fontSize: 14, color: '#3F3F46', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  panelMuted: { fontSize: 13, color: '#71717A', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  panelVal: { color: PRIMARY, fontWeight: '700' },
  copyBtn: {
    alignSelf: 'stretch',
    marginHorizontal: 8,
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: PRIMARY,
    alignItems: 'center',
  },
  copyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  diagnosis: {
    marginTop: 6,
    marginBottom: 6,
    fontSize: 13,
    lineHeight: 18,
    color: '#B45309',
    fontWeight: '700',
  },
  roomDebugRow: {
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    paddingTop: 8,
    marginTop: 8,
    gap: 2,
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  topBarText: { fontSize: 13, fontWeight: '600', color: '#71717A' },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
  },
  logoutText: { color: '#DC2626', fontWeight: '700', fontSize: 13 },

  primaryBtn: {
    marginTop: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: PRIMARY,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Bottom tabs
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    backgroundColor: '#fff',
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
  },
  tabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabIconWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabLabel: { fontSize: 15, color: '#71717A', fontWeight: '600' },
  tabLabelActive: { color: PRIMARY },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});

export default AppUnreadRepro;
