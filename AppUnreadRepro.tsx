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
  useState,
  useSyncExternalStore,
} from 'react';
import {
  ActivityIndicator,
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

import { XmppProvider } from './src/context/xmppProvider';
import { ReduxWrapper as Chat } from './src/components/MainComponents/ReduxWrapper';
import { useUnread } from './src/hooks/useUnreadMessagesCounter';
import { logoutService } from './src/hooks/useLogout';
import { store as chatStore } from './src/roomStore';
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
  const { hasUnread, totalCount, unreadByRoom } = useUnread();
  const entries = Object.entries(unreadByRoom || {});
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>useUnread()</Text>
      <Text style={styles.panelRow}>
        hasUnread: <Text style={styles.panelVal}>{String(hasUnread)}</Text>
      </Text>
      <Text style={styles.panelRow}>
        totalCount: <Text style={styles.panelVal}>{totalCount}</Text>
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

const HomeScreen: React.FC<{
  who: string;
  roomCount: number;
  roomJID?: string;
}> = ({ who, roomCount, roomJID }) => (
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

    <Text style={styles.muted}>
      Stay on this tab and have the OTHER account send a message — the
      Messages badge + the panel above should increment (the outer
      XmppProvider receives it via initBeforeLoad). Open Messages to clear it.
    </Text>
  </ScrollView>
);

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
    setBusy(true);
    try {
      await logoutService.performLogout();
    } catch {}
    setActiveTab('home');
    setSession('out');
    setBusy(false);
  }, []);

  const doLogin = useCallback(() => {
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
          />
        </View>

        {/* Messages stays mounted so the chat connection survives tab
            switches; isVisible follows focus, exactly like useIsFocused. */}
        <View style={[styles.flex, !isMessages && styles.hidden]}>
          {messagesPane}
        </View>
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
