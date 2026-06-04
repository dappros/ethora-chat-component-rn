import XmppClient from '../networking/xmppClient';
import { xmppSettingsInterface } from '../types/types';

interface XmppRegistryState {
  currentClient: XmppClient | null;
  currentClientKey: string;
  initLocks: Map<string, Promise<XmppClient>>;
}

const globalScope = globalThis as typeof globalThis & {
  __XMPP_REGISTRY__?: XmppRegistryState;
};

const registry: XmppRegistryState =
  globalScope.__XMPP_REGISTRY__ ||
  (globalScope.__XMPP_REGISTRY__ = {
    currentClient: null,
    currentClientKey: '',
    initLocks: new Map<string, Promise<XmppClient>>(),
  });

const DEFAULT_DEV_SERVER = 'xmpp.chat.ethora.com';

export function buildXmppClientKey(
  username: string,
  xmppSettings?: xmppSettingsInterface
): string {
  const devServer = xmppSettings?.devServer || DEFAULT_DEV_SERVER;
  const host = xmppSettings?.host || '';
  const conference = xmppSettings?.conference || '';
  return `${username}|${devServer}|${host}|${conference}`;
}

export function isXmppClientReusable(client: XmppClient | null): boolean {
  if (!client) {return false;}
  return client.status === 'online' || client.status === 'connecting';
}

export function setGlobalXmppClient(
  client: XmppClient | null,
  key?: string
): void {
  registry.currentClient = client;
  registry.currentClientKey = client
    ? key || registry.currentClientKey || ''
    : '';
}

export function getGlobalXmppClient(): XmppClient | null {
  return registry.currentClient;
}

export function getGlobalXmppClientKey(): string {
  return registry.currentClientKey;
}

export function getReusableXmppClientByKey(key: string): XmppClient | null {
  if (!key || key !== registry.currentClientKey) {return null;}
  if (!isXmppClientReusable(registry.currentClient)) {return null;}
  return registry.currentClient;
}

export async function withXmppClientInitLock(
  key: string,
  init: () => Promise<XmppClient>
): Promise<XmppClient> {
  const existing = registry.initLocks.get(key);
  if (existing) {return existing;}

  const createdPromise = init().finally(() => {
    if (registry.initLocks.get(key) === createdPromise) {
      registry.initLocks.delete(key);
    }
  });

  registry.initLocks.set(key, createdPromise);
  return createdPromise;
}

export function requireXmppClient(): XmppClient {
  if (!registry.currentClient) {
    throw new Error('XMPP client is not initialized');
  }
  return registry.currentClient;
}

export default {
  buildXmppClientKey,
  isXmppClientReusable,
  setGlobalXmppClient,
  getGlobalXmppClient,
  getGlobalXmppClientKey,
  getReusableXmppClientByKey,
  withXmppClientInitLock,
  requireXmppClient,
};
