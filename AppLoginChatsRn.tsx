/**
 * RN test harness for the local chat component.
 *
 *  ┌────────────────────────────────────────────┐
 *  │  [ Setup ]  [ Chat ]  [ Logs ]             │  tab strip
 *  ├────────────────────────────────────────────┤
 *  │                                            │
 *  │   Setup → form for entering chat creds     │
 *  │   Chat  → mounts the local <ReduxWrapper>  │
 *  │   Logs  → live feed (console+http+xmpp)    │
 *  │                                            │
 *  └────────────────────────────────────────────┘
 *
 * Creds are persisted to AsyncStorage so dev iterations don't repaste
 * the JWT. Logs are captured globally by `src/utils/devLogger` (console,
 * axios, XMPP stanza in/out).
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
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// LogBox dev-warning filtering lives in ./setupLogBox (imported first from
// index.js, before expo-av/styled-components warn at import time).
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
// `SafeAreaView` from `react-native` is deprecated and crucially does
// not subtract the Android nav-bar / gesture-bar inset, so the chat
// input collides with system controls on real devices. The
// context-aware version handles top + bottom insets on iOS and
// Android equally.
import { SafeAreaView } from 'react-native-safe-area-context';

import { ReduxWrapper as Chat } from './src/components/MainComponents/ReduxWrapper';
import { store as chatStore } from './src/roomStore';
import { logoutService } from './src/hooks/useLogout';
import type { IConfig, IRoom } from './src/types/types';
import {
  clearLogs,
  getLogs,
  installAxiosCapture,
  installConsoleCapture,
  LogEntry,
  LogKind,
  pushLog,
  subscribeLogs,
} from './src/utils/devLogger';

// Install console capture eagerly so logs collected during the very
// first render are kept. Also instrument the default axios instance so
// the Setup tab's `axios.post(.../users/client)` shows up in Logs.
installConsoleCapture();
installAxiosCapture(axios);

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
const PRIMARY = '#3fde74ff';
const SECONDARY = '#E1E4FE';
const BORDER = '#E5E7EB';
const MUTED = '#71717A';

// ---------------------------------------------------------------------
// Settings model — Setup tab persists both auth modes in one bag.
// ---------------------------------------------------------------------
const CREDS_KEY = '@apploginchatsrn/creds';

type LoginMode = 'jwt' | 'email';

interface AppUser {
  _id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  token: string;
  refreshToken?: string;
  xmppUsername: string;
  xmppPassword: string;
  walletAddress?: string;
  defaultWallet?: { walletAddress: string };
}

interface Creds {
  mode: LoginMode;
  // JWT mode
  jwt: string;
  // Email mode
  appToken: string;
  email: string;
  password: string;
  resolvedUser: AppUser | null; // populated by "Test connection" in email mode
  // Server
  baseUrl: string;
  xmppHost: string;
  xmppDevServer: string;
  conference?: string;
  // Room mode
  singleRoom: boolean;
  singleRoomJid: string;
}

// Server fields default to the QA environment (chat-qa.ethora.com) so a
// fresh checkout points somewhere real. appToken/email/password default
// to a QA test account for the same reason.
const DEFAULT_CREDS: Creds = {
  mode: 'email',
  jwt: '',
  // NOTE the `JWT ` scheme prefix: /users/login-with-email rejects a bare
  // token with 401 "authorization token verify error". The field is sent
  // verbatim as the Authorization header, so the prefix belongs here.
  appToken:
    'JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7ImlzVXNlckRhdGFFbmNyeXB0ZWQiOmZhbHNlLCJwYXJlbnRBcHBJZCI6bnVsbCwiaXNBbGxvd2VkTmV3QXBwQ3JlYXRlIjp0cnVlLCJpc0Jhc2VBcHAiOnRydWUsIl9pZCI6IjY0NmNjOGRjOTZkNGE0ZGM4ZjdiMmYyZCIsImRpc3BsYXlOYW1lIjoiRXRob3JhIiwiZG9tYWluTmFtZSI6ImV0aG9yYSIsImNyZWF0b3JJZCI6IjY0NmNjOGQzOTZkNGE0ZGM4ZjdiMmYyNSIsInVzZXJzQ2FuRnJlZSI6dHJ1ZSwiZGVmYXVsdEFjY2Vzc0Fzc2V0c09wZW4iOnRydWUsImRlZmF1bHRBY2Nlc3NQcm9maWxlT3BlbiI6dHJ1ZSwiYnVuZGxlSWQiOiJjb20uZXRob3JhIiwicHJpbWFyeUNvbG9yIjoiIzAwM0U5QyIsInNlY29uZGFyeUNvbG9yIjoiIzI3NzVFQSIsImNvaW5TeW1ib2wiOiJFVE8iLCJjb2luTmFtZSI6IkV0aG9yYSBDb2luIiwiUkVBQ1RfQVBQX0ZJUkVCQVNFX0FQSV9LRVkiOiJBSXphU3lEUWRrdnZ4S0t4NC1XcmpMUW9ZZjA4R0ZBUmdpX3FPNGciLCJSRUFDVF9BUFBfRklSRUJBU0VfQVVUSF9ET01BSU4iOiJldGhvcmEtNjY4ZTkuZmlyZWJhc2VhcHAuY29tIiwiUkVBQ1RfQVBQX0ZJUkVCQVNFX1BST0pFQ1RfSUQiOiJldGhvcmEtNjY4ZTkiLCJSRUFDVF9BUFBfRklSRUJBU0VfU1RPUkFHRV9CVUNLRVQiOiJldGhvcmEtNjY4ZTkuYXBwc3BvdC5jb20iLCJSRUFDVF9BUFBfRklSRUJBU0VfTUVTU0FHSU5HX1NFTkRFUl9JRCI6Ijk3MjkzMzQ3MDA1NCIsIlJFQUNUX0FQUF9GSVJFQkFTRV9BUFBfSUQiOiIxOjk3MjkzMzQ3MDA1NDp3ZWI6ZDQ2ODJlNzZlZjAyZmQ5YjljZGFhNyIsIlJFQUNUX0FQUF9GSVJFQkFTRV9NRUFTVVJNRU5UX0lEIjoiRy1XSE03WFJaNEM4IiwiUkVBQ1RfQVBQX1NUUklQRV9QVUJMSVNIQUJMRV9LRVkiOiIiLCJSRUFDVF9BUFBfU1RSSVBFX1NFQ1JFVF9LRVkiOiIiLCJjcmVhdGVkQXQiOiIyMDIzLTA1LTIzVDE0OjA4OjI4LjEzNloiLCJ1cGRhdGVkQXQiOiIyMDIzLTA1LTIzVDE0OjA4OjI4LjEzNloiLCJfX3YiOjB9LCJpYXQiOjE2ODQ4NTA5MjV9.-IqNVMsf8GyS9Z-_yuNW7hpSmejajjAy-W0J8TadRIM',
  email: 'randomroman@gmail.com',
  password: '12345678',
  resolvedUser: null,
  baseUrl: 'https://api.chat-qa.ethora.com/v1',
  xmppHost: 'xmpp.chat-qa.ethora.com',
  xmppDevServer: 'xmpp.chat-qa.ethora.com',
  conference: 'conference.xmpp.chat-qa.ethora.com',
  singleRoom: false,
  singleRoomJid: '',
};

// ---------------------------------------------------------------------
// Tab strip
// ---------------------------------------------------------------------
type Tab = 'setup' | 'chat' | 'logs';

// Subscribe to the chat library's module store so the TabBar (which
// lives outside `<Chat>` and therefore outside its react-redux
// Provider) can read room.unreadMessages without prop drilling.
const subscribeChatStore = (cb: () => void) => chatStore.subscribe(cb);
const getRoomsSnapshot = () => chatStore.getState().rooms.rooms;

const useTotalUnread = (): number => {
  const rooms = useSyncExternalStore(subscribeChatStore, getRoomsSnapshot);
  return useMemo(() => {
    let total = 0;
    for (const r of Object.values(rooms || {}) as IRoom[]) {
      const n = Number(r?.unreadMessages || 0);
      if (Number.isFinite(n) && n > 0) {total += n;}
    }
    return total;
  }, [rooms]);
};

const TabBar: React.FC<{ active: Tab; onChange: (t: Tab) => void }> = ({
  active,
  onChange,
}) => {
  const unread = useTotalUnread();
  return (
    <View style={styles.tabBar}>
      {(['setup', 'chat', 'logs'] as const).map((t) => (
        <Pressable
          key={t}
          onPress={() => onChange(t)}
          style={[styles.tabBtn, active === t && styles.tabBtnActive]}
        >
          <View style={styles.tabBtnRow}>
            <Text
              style={[
                styles.tabBtnText,
                active === t && styles.tabBtnTextActive,
              ]}
            >
              {t === 'setup' ? 'Setup' : t === 'chat' ? 'Chat' : 'Logs'}
            </Text>
            {t === 'chat' && unread > 0 ? (
              <View
                style={[
                  styles.tabBadge,
                  active === t && styles.tabBadgeOnActive,
                ]}
              >
                <Text
                  style={[
                    styles.tabBadgeText,
                    active === t && styles.tabBadgeTextOnActive,
                  ]}
                >
                  {unread > 99 ? '99+' : unread}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
};

// ---------------------------------------------------------------------
// Setup tab — JWT or Email mode, test + save
// ---------------------------------------------------------------------
const SetupTab: React.FC<{
  initial: Creds;
  onSave: (c: Creds) => void;
  onLogout: () => Promise<void>;
}> = ({ initial, onSave, onLogout }) => {
  const [mode, setMode] = useState<LoginMode>(initial.mode);
  // JWT fields
  const [jwt, setJwt] = useState(initial.jwt);
  // Email fields
  const [appToken, setAppToken] = useState(initial.appToken);
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState(initial.password);
  const [resolvedUser, setResolvedUser] = useState<AppUser | null>(
    initial.resolvedUser
  );
  // Server fields
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [xmppHost, setXmppHost] = useState(initial.xmppHost);
  const [xmppDevServer, setXmppDevServer] = useState(initial.xmppDevServer);
  const [conference, setConference] = useState(initial.conference || '');
  // Room mode
  const [singleRoom, setSingleRoom] = useState<boolean>(initial.singleRoom);
  const [singleRoomJid, setSingleRoomJid] = useState<string>(initial.singleRoomJid);

  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  // Re-sync local form state when the resolved user clears (logout) or
  // when the parent swaps the creds (e.g. user A → user B). Without this
  // the "Resolved user: X" line and the password field show stale data
  // until the next launch.
  useEffect(() => {
    setMode(initial.mode);
    setJwt(initial.jwt);
    setAppToken(initial.appToken);
    setEmail(initial.email);
    setPassword(initial.password);
    setResolvedUser(initial.resolvedUser);
    setBaseUrl(initial.baseUrl);
    setXmppHost(initial.xmppHost);
    setXmppDevServer(initial.xmppDevServer);
    setConference(initial.conference || '');
    setSingleRoom(initial.singleRoom);
    setSingleRoomJid(initial.singleRoomJid);
    setTestResult(null);
  }, [
    initial.mode,
    initial.jwt,
    initial.appToken,
    initial.email,
    initial.password,
    initial.resolvedUser,
    initial.baseUrl,
    initial.xmppHost,
    initial.xmppDevServer,
    initial.conference,
    initial.singleRoom,
    initial.singleRoomJid,
  ]);

  const collect = (overrides: Partial<Creds> = {}): Creds => ({
    mode,
    jwt: jwt.trim(),
    appToken: appToken.trim(),
    email: email.trim(),
    password,
    resolvedUser,
    baseUrl: baseUrl.trim().replace(/\/$/, ''),
    xmppHost: xmppHost.trim(),
    xmppDevServer: xmppDevServer.trim(),
    conference: conference.trim() || `conference.${xmppHost.trim()}`,
    singleRoom,
    singleRoomJid: singleRoomJid.trim(),
    ...overrides,
  });

  const handleTest = async () => {
    setBusy(true);
    setTestResult(null);
    const c = collect();
    try {
      if (c.mode === 'jwt') {
        if (!c.jwt) {
          setTestResult({ ok: false, text: 'Paste a JWT first.' });
          return;
        }
        const res = await axios.post(`${c.baseUrl}/users/client`, null, {
          headers: { 'x-custom-token': c.jwt },
        });
        const u = res.data?.user;
        if (!u || !res.data?.token) {
          setTestResult({ ok: false, text: 'Response missing user/token.' });
        } else {
          setTestResult({
            ok: true,
            text: `JWT OK\nuser: ${u.firstName || u.email || u._id}\nxmppUsername: ${u.xmppUsername}`,
          });
        }
      } else {
        // email mode
        if (!c.appToken) {
          setTestResult({ ok: false, text: 'App token required.' });
          return;
        }
        if (!c.email || !c.password) {
          setTestResult({ ok: false, text: 'Email and password required.' });
          return;
        }
        const res = await axios.post(
          `${c.baseUrl}/users/login-with-email`,
          { email: c.email, password: c.password },
          { headers: { Authorization: c.appToken } }
        );
        const data = res.data || {};
        const user: AppUser = {
          ...(data.user || {}),
          token: data.token,
          refreshToken: data.refreshToken,
        };
        if (!user.token || !user.xmppUsername || !user.xmppPassword) {
          setTestResult({
            ok: false,
            text: 'Email login returned incomplete user (missing token/xmppUsername/xmppPassword).',
          });
          setResolvedUser(null);
          return;
        }
        setResolvedUser(user);
        setTestResult({
          ok: true,
          text: `Email OK\nuser: ${user.firstName || user.email || user._id}\nxmppUsername: ${user.xmppUsername}`,
        });
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message || err?.message || 'Unknown error';
      setTestResult({ ok: false, text: `Failed: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    const c = collect();
    if (c.mode === 'jwt') {
      if (!c.jwt) {
        setTestResult({ ok: false, text: 'JWT required.' });
        return;
      }
    } else {
      if (!c.appToken || !c.email || !c.password) {
        setTestResult({
          ok: false,
          text: 'App token, email, and password required.',
        });
        return;
      }
      if (!c.resolvedUser) {
        setTestResult({
          ok: false,
          text: 'Hit "Test connection" first to resolve the user.',
        });
        return;
      }
    }
    onSave(c);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex1}
    >
      <ScrollView
        contentContainerStyle={styles.setupBody}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.h2}>Chat credentials</Text>
        <Text style={styles.helpText}>
          Choose JWT (client-token via `/users/client`) or Email (login via
          `/users/login-with-email` with an app token in `Authorization`).
          Save and switch to the Chat tab to start.
        </Text>

        {/* Mode toggle */}
        <View style={styles.modeRow}>
          {(['jwt', 'email'] as const).map((m) => (
            <Pressable
              key={m}
              testID={`mode-${m}`}
              onPress={() => {
                setMode(m);
                setTestResult(null);
              }}
              style={[
                styles.modeBtn,
                mode === m && styles.modeBtnActive,
              ]}
            >
              <Text
                style={[
                  styles.modeBtnText,
                  mode === m && styles.modeBtnTextActive,
                ]}
              >
                {m === 'jwt' ? 'JWT' : 'Email'}
              </Text>
            </Pressable>
          ))}
        </View>

        {mode === 'jwt' ? (
          <Field label="JWT (client token)" multiline>
            <TextInput
              testID="input-jwt"
              value={jwt}
              onChangeText={setJwt}
              placeholder="eyJhbGciOi..."
              multiline
              numberOfLines={6}
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.inputMulti}
            />
          </Field>
        ) : (
          <>
            <Field label="App token (Authorization header)" multiline>
              <TextInput
                testID="input-app-token"
                value={appToken}
                onChangeText={setAppToken}
                placeholder="eyJhbGciOi... (paste your app's JWT)"
                multiline
                numberOfLines={5}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.inputMulti}
              />
            </Field>
            <Field label="Email">
              <TextInput
                testID="input-email"
                value={email}
                onChangeText={setEmail}
                placeholder="user@example.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={styles.input}
              />
            </Field>
            <Field label="Password">
              <TextInput
                testID="input-password"
                value={password}
                onChangeText={setPassword}
                placeholder="••••••••"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
            </Field>
            {resolvedUser ? (
              <Text style={styles.resolvedHint}>
                Resolved user: {resolvedUser.firstName || resolvedUser.email}{' '}
                ({resolvedUser.xmppUsername})
              </Text>
            ) : null}
          </>
        )}

        <Field label="Base URL">
          <TextInput
            value={baseUrl}
            onChangeText={setBaseUrl}
            placeholder="https://api.chat.ethora.com/v1"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field label="XMPP host">
          <TextInput
            value={xmppHost}
            onChangeText={setXmppHost}
            placeholder="xmpp.chat.ethora.com"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field label="XMPP dev server (host:port)">
          <TextInput
            value={xmppDevServer}
            onChangeText={setXmppDevServer}
            placeholder="xmpp.chat.ethora.com"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field label="MUC conference (optional)">
          <TextInput
            value={conference}
            onChangeText={setConference}
            placeholder="conference.xmpp.chat.ethora.com"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <View style={styles.mb12}>
          <Pressable
            testID="toggle-single-room"
            onPress={() => setSingleRoom((v) => !v)}
            style={styles.toggleRow}
          >
            <View
              style={[
                styles.toggleTrack,
                singleRoom && styles.toggleTrackOn,
              ]}
            >
              <View
                style={[
                  styles.toggleThumb,
                  singleRoom && styles.toggleThumbOn,
                ]}
              />
            </View>
            <View style={styles.toggleLabelBox}>
              <Text style={styles.toggleLabel}>Single room mode</Text>
              <Text style={styles.toggleHint}>
                {singleRoom
                  ? 'Chat will open the JID below directly.'
                  : 'Show a list of all rooms; tap one to open.'}
              </Text>
            </View>
          </Pressable>
        </View>

        {singleRoom ? (
          <Field label="Single room JID">
            <TextInput
              testID="input-single-room-jid"
              value={singleRoomJid}
              onChangeText={setSingleRoomJid}
              placeholder="myroom@conference.xmpp.chat.ethora.com"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
          </Field>
        ) : null}

        {testResult && (
          <View
            style={[
              styles.banner,
              testResult.ok ? styles.bannerOk : styles.bannerErr,
            ]}
          >
            <Text style={styles.bannerText}>{testResult.text}</Text>
          </View>
        )}

        <View style={styles.btnRow}>
          <Pressable
            testID="setup-test"
            disabled={busy}
            onPress={handleTest}
            style={({ pressed }) => [
              styles.secondaryBtn,
              (pressed || busy) && styles.btnPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={PRIMARY} />
            ) : (
              <Text style={styles.secondaryBtnText}>Test connection</Text>
            )}
          </Pressable>
          <Pressable
            testID="setup-save"
            onPress={handleSave}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.btnPressed,
            ]}
          >
            <Text style={styles.primaryBtnText}>Save &amp; use</Text>
          </Pressable>
        </View>

        <Pressable
          testID="setup-logout"
          onPress={async () => {
            setBusy(true);
            try {
              await onLogout();
              pushLog('rn', 'Logout complete: xmpp disconnected, redux + persist + push cleared');
              setTestResult({
                ok: true,
                text:
                  'Logged out. XMPP disconnected, redux + persisted state + push subscriptions cleared. Testbed creds cleared too.',
              });
            } catch (err: any) {
              setTestResult({
                ok: false,
                text: `Logout failed: ${err?.message || err}`,
              });
            } finally {
              setBusy(false);
            }
          }}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { marginTop: 16 },
            (pressed || busy) && styles.btnPressed,
          ]}
        >
          <Text style={styles.secondaryBtnText}>Logout</Text>
        </Pressable>

        <Pressable
          testID="setup-clear-storage"
          onPress={async () => {
            try {
              await AsyncStorage.clear();
              pushLog('rn', 'AsyncStorage cleared (sledgehammer)');
              setTestResult({
                ok: true,
                text: 'Storage cleared. Reload the app to start fresh.',
              });
            } catch (err: any) {
              setTestResult({
                ok: false,
                text: `Failed to clear storage: ${err?.message || err}`,
              });
            }
          }}
          style={({ pressed }) => [
            styles.dangerBtn,
            pressed && styles.btnPressed,
          ]}
        >
          <Text style={styles.dangerBtnText}>Clear AsyncStorage</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const Field: React.FC<{
  label: string;
  multiline?: boolean;
  children: React.ReactNode;
}> = ({ label, multiline, children }) => (
  <View style={styles.mb12}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
    {multiline ? <View style={styles.fieldSpacer} /> : null}
  </View>
);

// ---------------------------------------------------------------------
// Chat pane — mounts the local chat component once creds are valid
// ---------------------------------------------------------------------
const ChatPane: React.FC<{ creds: Creds | null; isVisible: boolean }> = ({ creds, isVisible }) => {
  const config = useMemo<IConfig | null>(() => {
    if (!creds) {return null;}
    const base = {
      baseUrl: creds.baseUrl,
      xmppSettings: {
        devServer: creds.xmppDevServer,
        host: creds.xmppHost,
        conference: creds.conference,
      },
      colors: {
        primary: PRIMARY,
        secondary: SECONDARY,
        avatar: PRIMARY,
        // icon: '#1fb0dcff',
        // dateLabel: '#1fb0dcff',
      },
      // `mode` omitted → defaults to 'auto': the translation renders inline
      // as the message body (original quoted above), no tap needed. The
      // reader can still switch to manual via the globe-icon language picker.
      translates: {
        enabled: true,
      },
      refreshTokens: { enabled: true },
      initBeforeLoad: true,
      disableInteractions: false,
      disableReactions: false,
      enableAudio: true,
      // Single flag for every entry point to the user-profile popup:
      // ChatHeader title press AND the in-bubble avatar tap. The bubble
      // avatar fix landed alongside this — `Message.tsx` now respects this
      // gate the same way `ChatHeader` already did.
      disableProfilesInteractions: true,
      keyboardVerticalOffset: Platform.OS === 'ios' ? 130 : 100,
      disableChatHeaderBurgerMenuIcon: true,
      disableChatInfo: {
        disableDescription: true,
        disableType: true,
        // Make the chat icon read-only — no press-to-edit picker, no
        // remove affordance, regardless of the user's role.
        disableIconEdit: true,
        disableRoomMenu: true
      },
      disableMemberProfileActions: true
    } as IConfig;

    if (creds.mode === 'jwt') {
      if (!creds.jwt) {return null;}
      return {
        ...base,
        jwtLogin: { enabled: true, token: creds.jwt },
      } as IConfig;
    }
    // email mode — user already resolved by Setup's "Test connection".
    if (!creds.resolvedUser || !creds.appToken) {return null;}
    return {
      ...base,
      customAppToken: creds.appToken,
      userLogin: { enabled: true, user: creds.resolvedUser as any },
    } as IConfig;
  }, [creds]);

  // Stable cache key so the chat re-mounts only when meaningful auth
  // identity changes (not on every keystroke during setup).
  const keyId = useMemo(() => {
    if (!creds) {return 'no-creds';}
    if (creds.mode === 'jwt') {return `jwt:${creds.jwt.slice(0, 24)}`;}
    return `email:${creds.resolvedUser?._id || creds.email}`;
  }, [creds]);

  const singleRoomMode = !!(creds?.singleRoom && creds.singleRoomJid);
  const chatRoomJid = singleRoomMode ? creds?.singleRoomJid : undefined;
  // disableRooms tells the chat to skip its own RoomList; we want the
  // list when the user isn't in single-room mode (mirroring web).
  const chatConfig = useMemo<IConfig | null>(
    () => (config ? ({ ...config, disableRooms: singleRoomMode } as IConfig) : null),
    [config, singleRoomMode]
  );

  if (!chatConfig) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>
          Open the Setup tab and save your credentials first.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.flex1}>
      {/*
        `key` on the chat forces a hard remount when the user picks a
        different account. Without it the in-flight XMPP client would
        carry over with the old session.
      */}
      <Chat key={keyId} config={chatConfig} roomJID={chatRoomJid} isVisible={isVisible} />
    </View>
  );
};

// ---------------------------------------------------------------------
// Logs pane
// ---------------------------------------------------------------------
const KIND_COLORS: Record<LogKind, { bg: string; fg: string }> = {
  log:   { bg: '#F4F4F5', fg: '#27272A' },
  info:  { bg: '#DBEAFE', fg: '#1E3A8A' },
  warn:  { bg: '#FEF3C7', fg: '#92400E' },
  error: { bg: '#FEE2E2', fg: '#B91C1C' },
  http:  { bg: '#DCFCE7', fg: '#166534' },
  xmpp:  { bg: SECONDARY, fg: PRIMARY },
  rn:    { bg: '#F1F5F9', fg: '#1E293B' },
};

const ALL_KINDS: LogKind[] = ['xmpp', 'http', 'error', 'warn', 'info', 'log'];

const useDevLogs = (): LogEntry[] =>
  useSyncExternalStore(subscribeLogs, getLogs);

const LogsPane: React.FC = () => {
  const all = useDevLogs();
  const [filters, setFilters] = useState<Set<LogKind>>(
    () => new Set(ALL_KINDS)
  );
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<FlatList<LogEntry>>(null);

  const entries = useMemo(
    () => all.filter((e) => filters.has(e.kind)),
    [all, filters]
  );

  useEffect(() => {
    if (autoScroll && entries.length) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [entries.length, autoScroll]);

  const toggleFilter = (k: LogKind) => {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {next.delete(k);}
      else {next.add(k);}
      return next;
    });
  };

  return (
    <View style={styles.flex1}>
      <View style={styles.logsToolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pr8}
        >
          {ALL_KINDS.map((k) => {
            const active = filters.has(k);
            const c = KIND_COLORS[k];
            return (
              <Pressable
                key={k}
                onPress={() => toggleFilter(k)}
                style={[
                  styles.filterChip,
                  // eslint-disable-next-line react-native/no-inline-styles -- dynamic theme color
                  {
                    backgroundColor: active ? c.bg : 'white',
                    borderColor: active ? c.fg : BORDER,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    { color: active ? c.fg : MUTED },
                  ]}
                >
                  {k}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.logsToolbarRight}>
          <Pressable
            onPress={() => setAutoScroll((s) => !s)}
            style={[
              styles.toolbarBtn,
              autoScroll && { backgroundColor: SECONDARY },
            ]}
          >
            <Text style={styles.toolbarBtnText}>
              {autoScroll ? '⤓ Auto' : '⤓ Off'}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => clearLogs()}
            style={styles.toolbarBtn}
          >
            <Text style={styles.toolbarBtnText}>Clear</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={entries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <LogRow
            entry={item}
            expanded={!!expanded[item.id]}
            onPress={() =>
              setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }))
            }
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>No log entries yet.</Text>
          </View>
        }
        onScrollBeginDrag={() => setAutoScroll(false)}
      />
    </View>
  );
};

const LogRow: React.FC<{
  entry: LogEntry;
  expanded: boolean;
  onPress: () => void;
}> = ({ entry, expanded, onPress }) => {
  const c = KIND_COLORS[entry.kind] || KIND_COLORS.log;
  const time = new Date(entry.ts).toISOString().slice(11, 23);
  return (
    <Pressable onPress={onPress} style={styles.logRow}>
      <View style={styles.logHeader}>
        <Text style={styles.logTime}>{time}</Text>
        <View
          style={[styles.kindBadge, { backgroundColor: c.bg }]}
        >
          <Text style={[styles.kindBadgeText, { color: c.fg }]}>
            {entry.kind}
          </Text>
        </View>
        <Text numberOfLines={expanded ? 0 : 2} style={styles.logMsg}>
          {entry.message}
        </Text>
      </View>
      {expanded && entry.details ? (
        <Text style={styles.logDetails} selectable>
          {entry.details}
        </Text>
      ) : null}
    </Pressable>
  );
};

// ---------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------
const AppLoginChatsRn: React.FC = () => {
  const [tab, setTab] = useState<Tab>('setup');
  const [creds, setCreds] = useState<Creds | null>(null);
  const [loading, setLoading] = useState(true);
  // Chat-tab visibility is signalled to <Chat> via its public `isVisible`
  // prop (see render below). The library clears/restores room visibility
  // and flushes lastViewed internally, so the testbed no longer reaches
  // into the chat store to manage unread — the wrong layer for a packaged
  // component.

  // Restore creds from AsyncStorage on first mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CREDS_KEY);
        if (raw) {
          const parsed = { ...DEFAULT_CREDS, ...JSON.parse(raw) };
          // Server fields fall back to the current defaults when the
          // persisted value is blank, so bumping DEFAULT_CREDS (e.g. to
          // point the testbed at a different environment) takes effect
          // for anyone who hasn't customized these fields themselves.
          parsed.baseUrl = parsed.baseUrl || DEFAULT_CREDS.baseUrl;
          parsed.xmppHost = parsed.xmppHost || DEFAULT_CREDS.xmppHost;
          parsed.xmppDevServer =
            parsed.xmppDevServer || DEFAULT_CREDS.xmppDevServer;
          parsed.conference = parsed.conference || DEFAULT_CREDS.conference;
          setCreds(parsed);
          pushLog('rn', 'Restored creds from AsyncStorage (staying on Setup)');
          // Intentionally DO NOT auto-jump to Chat on startup — the app
          // always opens on the Setup tab, even when creds are already
          // saved, so you can review/edit them first. (Pressing Save in
          // Setup still navigates to Chat; see handleSave.)
        }
      } catch (err) {
        pushLog('error', 'Failed to read creds', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = useCallback(async (c: Creds) => {
    setCreds(c);
    try {
      await AsyncStorage.setItem(CREDS_KEY, JSON.stringify(c));
      pushLog('rn', 'Saved creds; switching to Chat tab');
    } catch (err) {
      pushLog('error', 'Failed to persist creds', err);
    }
    setTab('chat');
  }, []);

  const handleLogout = useCallback(async () => {
    // 1. Library teardown — XMPP disconnect, redux wipe, persist
    //    clear, push subscriptions clear, REST cache clear.
    await logoutService.performLogout();
    // 2. Testbed-owned state: clear the cached creds and reset the
    //    UI to a logged-out shape (back to Setup tab with empty
    //    fields). Without this, the chat tab would still try to
    //    re-bootstrap because creds in component state still look
    //    "ready" — and on next reload, the persisted CREDS_KEY would
    //    auto-login again.
    try {
      await AsyncStorage.removeItem(CREDS_KEY);
    } catch (err) {
      pushLog('error', 'Failed to remove testbed creds', err);
    }
    setCreds(null);
    setTab('setup');
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.center]}>
        <ActivityIndicator color={PRIMARY} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar barStyle="dark-content" />
      <TabBar active={tab} onChange={setTab} />
      <View style={styles.flex1}>
        {/*
          Render all three panels with display:flex/none so state is
          preserved across tab switches (logs especially — we want the
          buffer to keep filling regardless of which tab is showing).
        */}
        <View
          style={[
            styles.pane,
            tab === 'setup' ? styles.paneShown : styles.paneHidden,
          ]}
          pointerEvents={tab === 'setup' ? 'auto' : 'none'}
        >
          <SetupTab
            initial={creds || DEFAULT_CREDS}
            onSave={handleSave}
            onLogout={handleLogout}
          />
        </View>
        <View
          style={[
            styles.pane,
            tab === 'chat' ? styles.paneShown : styles.paneHidden,
          ]}
          pointerEvents={tab === 'chat' ? 'auto' : 'none'}
        >
          <ChatPane creds={creds} isVisible={tab === 'chat'} />
        </View>
        <View
          style={[
            styles.pane,
            tab === 'logs' ? styles.paneShown : styles.paneHidden,
          ]}
          pointerEvents={tab === 'logs' ? 'auto' : 'none'}
        >
          <LogsPane />
        </View>
      </View>
    </SafeAreaView>
  );
};

export default AppLoginChatsRn;
export { AppLoginChatsRn };

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------
const styles = StyleSheet.create({
  flex1: { flex: 1 },
  mb12: { marginBottom: 12 },
  pr8: { paddingRight: 8 },
  fieldSpacer: { height: 4 },
  root: { flex: 1, backgroundColor: 'white' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: MUTED },
  pane: { ...StyleSheet.absoluteFillObject },
  paneShown: { display: 'flex' },
  paneHidden: { display: 'none' },
  // tab bar
  tabBar: {
    flexDirection: 'row',
    padding: 6,
    backgroundColor: '#F4F4F5',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabBtnActive: { backgroundColor: PRIMARY },
  tabBtnText: { color: MUTED, fontWeight: '500' },
  tabBtnTextActive: { color: 'white', fontWeight: '600' },
  tabBtnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabBadge: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeOnActive: {
    backgroundColor: 'white',
  },
  tabBadgeText: {
    color: 'white',
    fontSize: 11,
    fontWeight: '700',
  },
  tabBadgeTextOnActive: {
    color: PRIMARY,
  },
  // setup
  setupBody: { padding: 16, paddingBottom: 48 },
  h2: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  helpText: { fontSize: 12, color: MUTED, lineHeight: 18, marginBottom: 16 },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: '#F4F4F5',
    borderRadius: 8,
    padding: 4,
    marginBottom: 16,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 6,
  },
  modeBtnActive: { backgroundColor: 'white', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  modeBtnText: { color: MUTED, fontWeight: '500' },
  modeBtnTextActive: { color: PRIMARY, fontWeight: '700' },
  resolvedHint: {
    fontSize: 12,
    color: '#166534',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#27272A',
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    fontSize: 14,
    color: '#111827',
  },
  inputMulti: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    minHeight: 120,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    textAlignVertical: 'top',
    color: '#111827',
  },
  banner: {
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  bannerOk: { backgroundColor: '#DCFCE7' },
  bannerErr: { backgroundColor: '#FEE2E2' },
  bannerText: { fontSize: 13, color: '#111827' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: PRIMARY,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 6,
  },
  primaryBtnText: { color: 'white', fontWeight: '600' },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: PRIMARY,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 6,
  },
  secondaryBtnText: { color: PRIMARY, fontWeight: '600' },
  dangerBtn: {
    marginTop: 24,
    borderWidth: 1,
    borderColor: '#B91C1C',
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  dangerBtnText: { color: '#B91C1C', fontWeight: '600', fontSize: 13 },
  btnPressed: { opacity: 0.7 },
  // single-room toggle
  toggleRow: { flexDirection: 'row', alignItems: 'center' },
  toggleTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#D4D4D8',
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: { backgroundColor: PRIMARY },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'white',
    transform: [{ translateX: 0 }],
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },
  toggleLabelBox: { flex: 1, marginLeft: 12 },
  toggleLabel: { fontSize: 14, fontWeight: '600', color: '#27272A' },
  toggleHint: { fontSize: 11, color: MUTED, marginTop: 2 },
  // logs
  logsToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
    backgroundColor: 'white',
  },
  logsToolbarRight: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginRight: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  toolbarBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: BORDER,
    marginLeft: 4,
  },
  toolbarBtnText: { fontSize: 12, color: '#27272A' },
  logRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F1F1F4',
  },
  logHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  logTime: {
    fontSize: 10,
    color: MUTED,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    width: 88,
  },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  kindBadgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  logMsg: { flex: 1, fontSize: 12, color: '#27272A' },
  logDetails: {
    fontSize: 10,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
    color: MUTED,
    marginTop: 6,
    marginLeft: 100,
    paddingRight: 12,
  },
});
