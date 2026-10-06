import { Platform } from 'react-native';
import type { Client } from '@xmpp/client';
import { store } from '../roomStore';
import type { Omemo } from './omemo';

export { NS_OMEMO } from './ns';
export type { Decrypted, DeviceInfo, Trust, Omemo } from './omemo';

let enabled = false;
let instance: Omemo | undefined;
let starting: Promise<Omemo | undefined> | undefined;
let live: Client | undefined;
let generation = 0;

const bareJidOf = (client: Client | undefined): string | undefined =>
  client?.jid?.bare?.().toString()?.toLowerCase() || undefined;

const deviceLabel = (): string =>
  Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Mobile';

export function setE2eeEnabled(value: boolean): void {
  if (enabled === value) {return;}
  enabled = value;
  if (!enabled) {
    instance = undefined;
    starting = undefined;
    generation++;
  } else {
    void maybeStart();
  }
}

export function isE2eeEnabled(): boolean {
  return enabled;
}

export function onOnline(client: Client): void {
  live = client;
  if (instance && instance.jid === bareJidOf(client)) {
    instance.useClient(client);
    void instance.ensurePublished();
    return;
  }
  void maybeStart();
}

function maybeStart(): Promise<Omemo | undefined> {
  const client = live;
  if (!enabled || !client) {return Promise.resolve(undefined);}
  const jid = bareJidOf(client);
  if (!jid) {return Promise.resolve(undefined);}
  if (instance && instance.jid === jid) {return Promise.resolve(instance);}
  if (starting) {return starting;}

  const mine = ++generation;
  starting = (async () => {
    await Promise.resolve();
    try {
      const { Omemo: OmemoClass } = require('./omemo') as typeof import('./omemo');
      const { openDeviceStore } =
        require('./deviceStore') as typeof import('./deviceStore');
      const keyStore = await openDeviceStore(jid);
      const created = await OmemoClass.open(client, jid, keyStore, {
        label: deviceLabel(),
      });
      if (mine !== generation) {return undefined;}
      if (live && live !== client) {created.useClient(live);}
      instance = created;
      if (__DEV__) {
        console.log(
          `[e2ee] device ${created.deviceId} ready for ${jid} (${created.fingerprint})`
        );
      }
      return instance;
    } catch (err) {
      console.warn('[e2ee] could not start', err);
      return undefined;
    } finally {
      if (mine === generation) {starting = undefined;}
    }
  })();
  return starting;
}

export function stopOmemo(): void {
  instance = undefined;
  starting = undefined;
  live = undefined;
  generation++;
}

export function omemo(): Omemo | undefined {
  return enabled ? instance : undefined;
}

export function omemoReady(): Promise<Omemo | undefined> {
  if (!enabled) {return Promise.resolve(undefined);}
  if (instance) {return Promise.resolve(instance);}
  return starting ?? maybeStart();
}

export function isE2eeRoom(roomJid?: string | null): boolean {
  if (!roomJid) {return false;}
  const jid = roomJid.split('/')[0]!;
  return Boolean(store.getState()?.rooms?.rooms?.[jid]?.e2ee);
}

export function canSendToRoom(roomJid?: string | null): boolean {
  return enabled || !isE2eeRoom(roomJid);
}

export function canEditMessage(
  message?: { roomJid?: string; unencrypted?: boolean } | null
): boolean {
  if (!message) {return false;}
  return message.unencrypted === true || !isE2eeRoom(message.roomJid);
}

export function canSendMediaToRoom(roomJid?: string | null): boolean {
  return enabled || !isE2eeRoom(roomJid);
}

export function roomRecipients(roomJid: string, domain: string): string[] {
  const jid = roomJid.split('/')[0]!;
  const members = store.getState()?.rooms?.rooms?.[jid]?.members ?? [];
  return toAccounts(members, domain);
}

const toAccounts = (members: any[], domain: string): string[] =>
  members
    .map((m: any) => String(m?.xmppUsername || '').split('@')[0])
    .filter(Boolean)
    .map((local: string) => `${local}@${domain}`.toLowerCase());

const FETCHED_MEMBERS_TTL = 60_000;
const fetchedMembers = new Map<string, { at: number; accounts: Promise<string[]> }>();

export async function resolveRecipients(
  roomJid: string,
  domain: string
): Promise<string[]> {
  const jid = roomJid.split('/')[0]!;
  const known = roomRecipients(roomJid, domain);
  const expected = Number(store.getState()?.rooms?.rooms?.[jid]?.usersCnt || 0);
  if (known.length > 0 && known.length >= expected) {return known;}

  const cached = fetchedMembers.get(jid);
  if (cached && Date.now() - cached.at < FETCHED_MEMBERS_TTL) {return cached.accounts;}

  const accounts = (async () => {
    const api =
      require('../networking/api-requests/rooms.api') as typeof import('../networking/api-requests/rooms.api');
    const response: any = await api.getRoomByName(jid.split('@')[0]!);
    const room = response?.result ?? response;
    const appId = api.ownAppId();
    const found = toAccounts(
      (room?.members || []).map((m: any) => ({
        xmppUsername: api.memberAccount(m, appId),
      })),
      domain
    );
    if (found.length === 0) {throw new Error('no members returned');}
    if (found.length < known.length) {return known;}
    return found;
  })().catch((err) => {
    fetchedMembers.delete(jid);
    throw new Error(
      `omemo_members_unknown: ${String((err as Error)?.message || err)}`
    );
  });
  fetchedMembers.set(jid, { at: Date.now(), accounts });
  return accounts;
}

export function senderJidFromMuc(
  from: string | undefined,
  domain: string
): string | undefined {
  const nick = String(from || '').split('/')[1];
  if (!nick || !domain) {return undefined;}
  return `${nick}@${domain}`.toLowerCase();
}

export function accountDomain(client: Client | undefined): string {
  return String(client?.jid?.getDomain?.() || '').toLowerCase();
}

export const __resetE2eeForTests = (): void => {
  enabled = false;
  stopOmemo();
  fetchedMembers.clear();
};
