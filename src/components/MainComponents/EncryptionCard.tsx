import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LockIcon } from '../../assets/icons';
import { useTheme } from '../../hooks/useTheme';
import { useT } from '../../i18n/useT';
import { useToast } from '../../context/ToastContext';
import { omemoReady, type DeviceInfo, type Trust } from '../../e2ee';

interface EncryptionCardProps {
  account?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type Loaded =
  | { state: 'loading' }
  | { state: 'unavailable' }
  | { state: 'ready'; jid: string; own: boolean; devices: DeviceInfo[] };

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

const twoLines = (fingerprint: string): string => {
  const groups = fingerprint.split(' ');
  const half = Math.ceil(groups.length / 2);
  return `${groups.slice(0, half).join(' ')}\n${groups.slice(half).join(' ')}`;
};

const EncryptionCard: React.FC<EncryptionCardProps> = ({ account, style, testID }) => {
  const theme = useTheme();
  const t = useT();
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const load = useCallback(async () => {
    try {
      const device = await omemoReady();
      if (!device) {
        if (mounted.current) {setLoaded({ state: 'unavailable' });}
        return;
      }
      const domain = device.jid.split('@')[1] || '';
      const local = String(account || '').split('@')[0]!.toLowerCase();
      const jid = local ? `${local}@${domain}` : device.jid;
      const devices = await device.devices(jid);
      if (mounted.current) {
        setLoaded({ state: 'ready', jid, own: jid === device.jid, devices });
      }
    } catch (error) {
      console.warn('[e2ee] could not list devices', error);
      if (mounted.current) {setLoaded({ state: 'unavailable' });}
    }
  }, [account]);

  useEffect(() => {
    void load();
  }, [load]);

  const copy = useCallback(
    async (fingerprint: string) => {
      try {
        const Clipboard = require('expo-clipboard');
        await Clipboard.setStringAsync(fingerprint);
        showToast({
          id: Date.now().toString(),
          title: t('e2ee.devices.title'),
          message: t('e2ee.devices.copied'),
          type: 'success',
        });
      } catch (error) {
        console.warn('[e2ee] could not copy the fingerprint', error);
      }
    },
    [showToast, t]
  );

  const setTrust = useCallback(
    async (jid: string, id: number, trust: Trust) => {
      try {
        const device = await omemoReady();
        await device?.setTrust(jid, id, trust);
      } catch (error) {
        console.warn('[e2ee] could not change trust', error);
      }
      void load();
    },
    [load]
  );

  const askTrust = useCallback(
    (jid: string, device: DeviceInfo) => {
      const choices: Array<{ trust: Trust; label: string }> = [
        { trust: 'verified', label: t('e2ee.trust.verify') },
        { trust: 'untrusted', label: t('e2ee.trust.distrust') },
        { trust: 'blind', label: t('e2ee.trust.reset') },
      ];
      Alert.alert(
        t('e2ee.trust.prompt', { id: device.id }),
        `${device.fingerprint}\n\n${t('e2ee.devices.hint')}`,
        [
          ...choices
            .filter((choice) => choice.trust !== device.trust)
            .map((choice) => ({
              text: choice.label,
              style: choice.trust === 'untrusted' ? ('destructive' as const) : ('default' as const),
              onPress: () => void setTrust(jid, device.id, choice.trust),
            })),
          { text: t('action.cancel'), style: 'cancel' as const },
        ]
      );
    },
    [setTrust, t]
  );

  const trustLabel: Record<Trust, string> = {
    verified: t('e2ee.trust.verified'),
    blind: t('e2ee.trust.blind'),
    untrusted: t('e2ee.trust.untrusted'),
  };
  const trustColor: Record<Trust, string> = {
    verified: theme.primary,
    blind: theme.textSecondary,
    untrusted: theme.danger,
  };

  const row = (jid: string, device: DeviceInfo, own: boolean) => {
    const mine = device.trust === 'own';
    return (
      <Pressable
        key={device.id}
        testID={`e2ee-device-${device.id}`}
        accessibilityRole="button"
        onPress={() => (own ? void copy(device.fingerprint) : askTrust(jid, device))}
        onLongPress={() => void copy(device.fingerprint)}
        style={[styles.row, { borderTopColor: theme.border }]}
      >
        <View style={styles.rowHead}>
          <Text style={[styles.device, { color: theme.text }]} numberOfLines={1}>
            {mine
              ? t('e2ee.devices.thisDevice')
              : t('e2ee.trust.prompt', { id: device.id })}
            {device.label ? ` · ${device.label}` : ''}
          </Text>
          {!mine && !own && (
            <Text
              testID={`e2ee-trust-${device.id}`}
              style={[styles.trust, { color: trustColor[device.trust as Trust] }]}
            >
              {trustLabel[device.trust as Trust]}
            </Text>
          )}
        </View>
        <Text style={[styles.fingerprint, { color: theme.textSecondary }]}>
          {twoLines(device.fingerprint)}
        </Text>
      </Pressable>
    );
  };

  let body: React.ReactNode;
  if (loaded.state === 'loading') {
    body = (
      <View style={styles.status}>
        <ActivityIndicator size="small" color={theme.textSecondary} />
        <Text style={[styles.note, { color: theme.textSecondary }]}>
          {t('e2ee.devices.loading')}
        </Text>
      </View>
    );
  } else if (loaded.state === 'unavailable') {
    body = (
      <Text style={[styles.note, { color: theme.textSecondary }]}>
        {t('e2ee.devices.unavailable')}
      </Text>
    );
  } else {
    const { jid, own, devices } = loaded;
    const ordered = [
      ...devices.filter((d) => d.trust === 'own'),
      ...devices.filter((d) => d.trust !== 'own'),
    ];
    const others = ordered.filter((d) => d.trust !== 'own');
    body = (
      <>
        {ordered.map((device) => row(jid, device, own))}
        {(own ? others.length === 0 : ordered.length === 0) && (
          <Text style={[styles.note, { color: theme.textSecondary }]}>
            {t(own ? 'e2ee.devices.noneOwn' : 'e2ee.devices.none')}
          </Text>
        )}
        {!own && ordered.length > 0 && (
          <Text style={[styles.hint, { color: theme.textMuted }]}>
            {t('e2ee.devices.hint')}
          </Text>
        )}
      </>
    );
  }

  return (
    <View style={[style, styles.card]} testID={testID || 'e2ee-devices'}>
      <View style={styles.head}>
        <LockIcon width={18} height={18} color={theme.textSecondary} />
        <Text style={[styles.title, { color: theme.text }]}>
          {t('e2ee.devices.title')}
        </Text>
      </View>
      {body}
    </View>
  );
};

export default EncryptionCard;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  note: {
    fontSize: 14,
    lineHeight: 19,
    paddingVertical: 4,
  },
  row: {
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  device: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  trust: {
    fontSize: 13,
    fontWeight: '600',
  },
  fingerprint: {
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 17,
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
  },
});
