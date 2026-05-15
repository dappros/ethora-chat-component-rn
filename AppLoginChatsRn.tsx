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
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

import { ReduxWrapper as Chat } from './src/components/MainComponents/ReduxWrapper';
import type { IConfig } from './src/types/types';
import {
  clearLogs,
  getLogs,
  installConsoleCapture,
  LogEntry,
  LogKind,
  pushLog,
  subscribeLogs,
} from './src/utils/devLogger';

// Install console capture eagerly so logs collected during the very
// first render are kept.
installConsoleCapture();

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
const PRIMARY = '#5E3FDE';
const SECONDARY = '#E1E4FE';
const BORDER = '#E5E7EB';
const MUTED = '#71717A';

// ---------------------------------------------------------------------
// Settings model
// ---------------------------------------------------------------------
const CREDS_KEY = '@apploginchatsrn/creds';

interface Creds {
  jwt: string;
  baseUrl: string;
  xmppHost: string;
  xmppDevServer: string;
  conference?: string;
}

const DEFAULT_CREDS: Creds = {
  jwt: '',
  baseUrl: 'https://api.chat.ethora.com/v1',
  xmppHost: 'xmpp.chat.ethora.com',
  xmppDevServer: 'xmpp.chat.ethora.com:5443',
  conference: 'conference.xmpp.chat.ethora.com',
};

// ---------------------------------------------------------------------
// Tab strip
// ---------------------------------------------------------------------
type Tab = 'setup' | 'chat' | 'logs';

const TabBar: React.FC<{ active: Tab; onChange: (t: Tab) => void }> = ({
  active,
  onChange,
}) => (
  <View style={styles.tabBar}>
    {(['setup', 'chat', 'logs'] as const).map((t) => (
      <Pressable
        key={t}
        onPress={() => onChange(t)}
        style={[styles.tabBtn, active === t && styles.tabBtnActive]}
      >
        <Text
          style={[
            styles.tabBtnText,
            active === t && styles.tabBtnTextActive,
          ]}
        >
          {t === 'setup' ? 'Setup' : t === 'chat' ? 'Chat' : 'Logs'}
        </Text>
      </Pressable>
    ))}
  </View>
);

// ---------------------------------------------------------------------
// Setup tab — cred entry + test
// ---------------------------------------------------------------------
const SetupTab: React.FC<{
  initial: Creds;
  onSave: (c: Creds) => void;
}> = ({ initial, onSave }) => {
  const [jwt, setJwt] = useState(initial.jwt);
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);
  const [xmppHost, setXmppHost] = useState(initial.xmppHost);
  const [xmppDevServer, setXmppDevServer] = useState(initial.xmppDevServer);
  const [conference, setConference] = useState(initial.conference || '');

  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const collect = (): Creds => ({
    jwt: jwt.trim(),
    baseUrl: baseUrl.trim().replace(/\/$/, ''),
    xmppHost: xmppHost.trim(),
    xmppDevServer: xmppDevServer.trim(),
    conference: conference.trim() || `conference.${xmppHost.trim()}`,
  });

  const handleTest = async () => {
    setBusy(true);
    setTestResult(null);
    const c = collect();
    if (!c.jwt) {
      setTestResult({ ok: false, text: 'Paste a JWT first.' });
      setBusy(false);
      return;
    }
    try {
      const res = await axios.post(
        `${c.baseUrl}/users/client`,
        null,
        { headers: { 'x-custom-token': c.jwt } }
      );
      const u = res.data?.user;
      if (!u || !res.data?.token) {
        setTestResult({ ok: false, text: 'Response missing user/token.' });
      } else {
        setTestResult({
          ok: true,
          text: `OK: ${u.firstName || u.email || u._id}\nxmppUsername=${u.xmppUsername}`,
        });
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Unknown error';
      setTestResult({ ok: false, text: `Failed: ${msg}` });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = () => {
    const c = collect();
    if (!c.jwt) {
      setTestResult({ ok: false, text: 'JWT required.' });
      return;
    }
    onSave(c);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={styles.setupBody}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.h2}>Chat credentials</Text>
        <Text style={styles.helpText}>
          The local chat component (`ReduxWrapper`) will POST your JWT to
          `/users/client` (jwtLogin flow) and use the returned creds to
          connect to XMPP. Save and switch to the Chat tab to start.
        </Text>

        <Field label="JWT" multiline>
          <TextInput
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
            placeholder="xmpp.chat.ethora.com:5443"
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
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const Field: React.FC<{
  label: string;
  multiline?: boolean;
  children: React.ReactNode;
}> = ({ label, multiline, children }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={styles.fieldLabel}>{label}</Text>
    {children}
    {multiline ? <View style={{ height: 4 }} /> : null}
  </View>
);

// ---------------------------------------------------------------------
// Chat pane — mounts the local chat component once creds are valid
// ---------------------------------------------------------------------
const ChatPane: React.FC<{ creds: Creds | null }> = ({ creds }) => {
  const config = useMemo<IConfig | null>(() => {
    if (!creds || !creds.jwt) return null;
    return {
      baseUrl: creds.baseUrl,
      xmppSettings: {
        devServer: creds.xmppDevServer,
        host: creds.xmppHost,
        conference: creds.conference,
      },
      colors: { primary: PRIMARY, secondary: SECONDARY },
      refreshTokens: { enabled: true },
      initBeforeLoad: true,
      jwtLogin: { enabled: true, token: creds.jwt },
    } as IConfig;
  }, [creds]);

  if (!config) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>
          Open the Setup tab and save your credentials first.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {/*
        `key` on the chat ensures a hard remount when the user saves
        different creds. Without it, an already-online XMPP client
        would keep the old JWT.
      */}
      <Chat key={creds!.jwt} config={config} />
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
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.logsToolbar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingRight: 8 }}
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

  // Restore creds from AsyncStorage on first mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CREDS_KEY);
        if (raw) {
          const parsed = { ...DEFAULT_CREDS, ...JSON.parse(raw) };
          setCreds(parsed);
          pushLog('rn', 'Restored creds from AsyncStorage');
          if (parsed.jwt) setTab('chat');
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
      <View style={{ flex: 1 }}>
        {/*
          Render all three panels with display:flex/none so state is
          preserved across tab switches (logs especially — we want the
          buffer to keep filling regardless of which tab is showing).
        */}
        <View
          style={[
            styles.pane,
            { display: tab === 'setup' ? 'flex' : 'none' },
          ]}
          pointerEvents={tab === 'setup' ? 'auto' : 'none'}
        >
          <SetupTab
            initial={creds || DEFAULT_CREDS}
            onSave={handleSave}
          />
        </View>
        <View
          style={[
            styles.pane,
            { display: tab === 'chat' ? 'flex' : 'none' },
          ]}
          pointerEvents={tab === 'chat' ? 'auto' : 'none'}
        >
          <ChatPane creds={creds} />
        </View>
        <View
          style={[
            styles.pane,
            { display: tab === 'logs' ? 'flex' : 'none' },
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
  root: { flex: 1, backgroundColor: 'white' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: MUTED },
  pane: { ...StyleSheet.absoluteFillObject },
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
  // setup
  setupBody: { padding: 16, paddingBottom: 48 },
  h2: { fontSize: 18, fontWeight: '600', marginBottom: 6 },
  helpText: { fontSize: 12, color: MUTED, lineHeight: 18, marginBottom: 16 },
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
  btnPressed: { opacity: 0.7 },
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
