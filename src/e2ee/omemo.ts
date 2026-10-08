import { xml, type Client } from '@xmpp/client';
import { Element, parse } from 'ltx';
import {
  bytesEqual,
  bytesToUtf8,
  fromBase64,
  generateIdentity,
  generateKeyPair,
  randomBytes,
  randomInt,
  sign,
  toBase64,
  toHex,
  utf8ToBytes,
  type IdentityKey,
  type KeyPair,
} from './crypto';
import { decodeKeyExchange, encodeKeyExchange } from './protobuf';
import {
  acceptSession,
  decryptPayload,
  encryptPayload,
  initiateSession,
  ratchetDecrypt,
  ratchetEncrypt,
  type Bundle,
  type Session,
} from './ratchet';
import type { OmemoStore } from './store';
import { NS_OMEMO } from './ns';

export { NS_OMEMO };
const NODE_DEVICES = 'urn:xmpp:omemo:2:devices';
const NODE_BUNDLES = 'urn:xmpp:omemo:2:bundles';
const NS_PUBSUB = 'http://jabber.org/protocol/pubsub';
const NS_PUBSUB_OWNER = 'http://jabber.org/protocol/pubsub#owner';
const NS_SCE = 'urn:xmpp:sce:1';
const PREKEY_COUNT = 100;
const PREKEY_SLICE = 5;
const DEFAULT_DEVICE_LABEL = 'Mobile';
const DEVICE_LIST_TTL = 30_000;

export const FALLBACK_BODY = 'Encrypted message';
export type Trust = 'blind' | 'verified' | 'untrusted';

interface OwnKeys {
  deviceId: number;
  identity: IdentityKey;
  spk: { id: number; pair: KeyPair; signature: Uint8Array };
  prekeys: Record<number, KeyPair>;
  nextPrekeyId: number;
}

interface DeviceRecord {
  ik: Uint8Array;
  trust: Trust;
}

export interface Decrypted {
  content?: string;
  trust: Trust | 'own';
  error?: string;
}

export interface DeviceInfo {
  id: number;
  fingerprint: string;
  trust: Trust | 'own';
  label?: string;
}

const bare = (jid: string) => jid.split('/')[0]!.toLowerCase();
const sessionKey = (jid: string, id: number) => `session:${jid}:${id}`;
const trustKey = (jid: string) => `trust:${jid}`;
const messageKey = (roomJid: string, id: string) =>
  `message:${bare(roomJid)}:${id}`;

export function formatFingerprint(ik: Uint8Array): string {
  return toHex(ik).match(/.{8}/g)!.join(' ');
}

const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function generateOwnKeys(): Promise<OwnKeys> {
  const identity = generateIdentity();
  const spkPair = generateKeyPair();
  const prekeys: Record<number, KeyPair> = {};
  for (let id = 1; id <= PREKEY_COUNT; id++) {
    prekeys[id] = generateKeyPair();
    if (id % PREKEY_SLICE === 0) {await yieldToUi();}
  }
  return {
    deviceId: randomInt(1, 0x7fffffff),
    identity,
    spk: { id: 1, pair: spkPair, signature: sign(identity, spkPair.pub) },
    prekeys,
    nextPrekeyId: PREKEY_COUNT + 1,
  };
}

function formField(name: string, value: string, type?: string): Element {
  return xml('field', { var: name, type }, xml('value', {}, value));
}

function isItemNotFound(err: unknown): boolean {
  return (err as { condition?: string })?.condition === 'item-not-found';
}

function isPreconditionNotMet(err: unknown): boolean {
  const condition = (err as { condition?: string })?.condition;
  return condition === 'precondition-not-met' || condition === 'conflict';
}

export class Omemo {
  readonly jid: string;
  private xmpp: Client;
  private readonly store: OmemoStore;
  private readonly label: string;
  private keys: OwnKeys;
  private queue: Promise<unknown> = Promise.resolve();
  private deviceLists = new Map<string, { ids: number[]; at: number }>();
  private publishing?: Promise<boolean>;

  private constructor(
    xmpp: Client,
    jid: string,
    store: OmemoStore,
    keys: OwnKeys,
    label: string
  ) {
    this.xmpp = xmpp;
    this.jid = jid;
    this.store = store;
    this.keys = keys;
    this.label = label;
  }

  static async create(
    xmpp: Client,
    jid: string,
    store: OmemoStore,
    options: { label?: string } = {}
  ): Promise<Omemo> {
    let keys = await store.get<OwnKeys>('keys');
    if (!keys) {
      keys = await generateOwnKeys();
      await store.set('keys', keys);
    }
    const omemo = new Omemo(
      xmpp,
      bare(jid),
      store,
      keys,
      options.label || DEFAULT_DEVICE_LABEL
    );
    await omemo.publishBundle();
    await omemo.announceDevice();
    omemo.publishing = Promise.resolve(true);
    return omemo;
  }

  static async open(
    xmpp: Client,
    jid: string,
    store: OmemoStore,
    options: { label?: string } = {}
  ): Promise<Omemo> {
    let keys = await store.get<OwnKeys>('keys');
    if (!keys) {
      keys = await generateOwnKeys();
      await store.set('keys', keys);
    }
    const omemo = new Omemo(
      xmpp,
      bare(jid),
      store,
      keys,
      options.label || DEFAULT_DEVICE_LABEL
    );
    void omemo.ensurePublished();
    return omemo;
  }

  published(): Promise<boolean> {
    return this.publishing ?? Promise.resolve(false);
  }

  ensurePublished(): Promise<boolean> {
    if (this.publishing) {return this.publishing;}
    const attempt = this.publishOnce();
    this.publishing = attempt;
    void attempt.then((ok) => {
      if (!ok && this.publishing === attempt) {this.publishing = undefined;}
    });
    return attempt;
  }

  private async publishOnce(): Promise<boolean> {
    try {
      await this.publishBundle();
      await this.announceDevice();
      return true;
    } catch (err) {
      console.warn('OMEMO: could not publish this device:', err);
      return false;
    }
  }

  useClient(xmpp: Client): void {
    this.xmpp = xmpp;
  }

  get deviceId(): number {
    return this.keys.deviceId;
  }

  get fingerprint(): string {
    return formatFingerprint(this.keys.identity.pub);
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  private async publishWithRecovery(
    node: string,
    itemId: string,
    payload: Element,
    maxItems?: string
  ) {
    try {
      await this.publish(node, itemId, payload, maxItems);
      return;
    } catch (err) {
      if (!isPreconditionNotMet(err)) {throw err;}
      console.warn(`OMEMO: ${node} rejected our publish-options, repairing`);
    }

    try {
      await this.configureNode(node, maxItems);
      await this.publish(node, itemId, payload, maxItems);
      return;
    } catch (err) {
      if (!isPreconditionNotMet(err)) {throw err;}
      console.warn(`OMEMO: reconfiguring ${node} did not help, recreating it`);
    }

    await this.deleteNode(node);
    await this.publish(node, itemId, payload, maxItems);
  }

  private async configureNode(node: string, maxItems?: string) {
    const fields: Element[] = [
      formField(
        'FORM_TYPE',
        'http://jabber.org/protocol/pubsub#node_config',
        'hidden'
      ),
      formField('pubsub#access_model', 'open'),
      formField('pubsub#persist_items', 'true'),
    ];
    if (maxItems) {fields.push(formField('pubsub#max_items', maxItems));}
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set' },
        xml(
          'pubsub',
          { xmlns: NS_PUBSUB_OWNER },
          xml(
            'configure',
            { node },
            xml('x', { xmlns: 'jabber:x:data', type: 'submit' }, ...fields)
          )
        )
      )
    );
  }

  private async deleteNode(node: string) {
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set' },
        xml('pubsub', { xmlns: NS_PUBSUB_OWNER }, xml('delete', { node }))
      )
    );
  }

  private async publish(
    node: string,
    itemId: string,
    payload: Element,
    maxItems?: string
  ) {
    const fields: Element[] = [
      formField(
        'FORM_TYPE',
        'http://jabber.org/protocol/pubsub#publish-options',
        'hidden'
      ),
      formField('pubsub#access_model', 'open'),
    ];
    if (maxItems) {fields.push(formField('pubsub#max_items', maxItems));}
    const options = xml(
      'publish-options',
      {},
      xml('x', { xmlns: 'jabber:x:data', type: 'submit' }, ...fields)
    );
    await this.xmpp.iqCaller.request(
      xml(
        'iq',
        { type: 'set' },
        xml(
          'pubsub',
          { xmlns: NS_PUBSUB },
          xml('publish', { node }, xml('item', { id: itemId }, payload)),
          options
        )
      )
    );
  }

  private async fetchItems(
    jid: string,
    node: string,
    itemId?: string
  ): Promise<Element[]> {
    try {
      const res = await this.xmpp.iqCaller.request(
        xml(
          'iq',
          { type: 'get', to: jid },
          xml(
            'pubsub',
            { xmlns: NS_PUBSUB },
            xml(
              'items',
              { node },
              ...(itemId ? [xml('item', { id: itemId })] : [])
            )
          )
        )
      );
      return (
        res
          .getChild('pubsub', NS_PUBSUB)
          ?.getChild('items')
          ?.getChildren('item') ?? []
      );
    } catch (err) {
      if (isItemNotFound(err)) {return [];}
      throw err;
    }
  }

  private async fetchDeviceList(jid: string): Promise<Element[]> {
    const items = await this.fetchItems(jid, NODE_DEVICES);
    const list = items.find((i) => i.attrs.id === 'current') ?? items[0];
    return (
      list?.getChild('devices', NS_OMEMO)?.getChildren('device') ?? []
    ).filter((d) => {
      const id = Number(d.attrs.id);
      return Number.isInteger(id) && id > 0 && id <= 0xffffffff;
    });
  }

  private async deviceIds(jid: string, fresh = false): Promise<number[]> {
    const cached = this.deviceLists.get(jid);
    if (cached && !fresh && Date.now() - cached.at < DEVICE_LIST_TTL) {
      return cached.ids;
    }
    const ids = (await this.fetchDeviceList(jid)).map((d) =>
      Number(d.attrs.id)
    );
    this.deviceLists.set(jid, { ids, at: Date.now() });
    return ids;
  }

  private async announceDevice() {
    const devices = await this.fetchDeviceList(this.jid);
    if (devices.some((d) => Number(d.attrs.id) === this.deviceId)) {return;}
    const list = xml(
      'devices',
      { xmlns: NS_OMEMO },
      ...devices.map((d) =>
        xml('device', { id: d.attrs.id, label: d.attrs.label })
      ),
      xml('device', { id: String(this.deviceId), label: this.label })
    );
    await this.publishWithRecovery(NODE_DEVICES, 'current', list);
    this.deviceLists.delete(this.jid);
  }

  private async publishBundle() {
    const { identity, spk, prekeys } = this.keys;
    const bundle = xml(
      'bundle',
      { xmlns: NS_OMEMO },
      xml('spk', { id: String(spk.id) }, toBase64(spk.pair.pub)),
      xml('spks', {}, toBase64(spk.signature)),
      xml('ik', {}, toBase64(identity.pub)),
      xml(
        'prekeys',
        {},
        ...Object.entries(prekeys).map(([id, pk]) =>
          xml('pk', { id }, toBase64(pk.pub))
        )
      )
    );
    await this.publishWithRecovery(
      NODE_BUNDLES,
      String(this.deviceId),
      bundle,
      'max'
    );
  }

  private async fetchBundle(jid: string, id: number): Promise<Bundle> {
    const items = await this.fetchItems(jid, NODE_BUNDLES, String(id));
    const el = items
      .find((i) => i.attrs.id === String(id))
      ?.getChild('bundle', NS_OMEMO);
    const spk = el?.getChild('spk');
    const prekeys = el?.getChild('prekeys')?.getChildren('pk') ?? [];
    if (!el || !spk || prekeys.length === 0) {
      throw new Error(`No usable bundle for ${jid}/${id}`);
    }
    const pk = prekeys[randomInt(0, prekeys.length - 1)]!;
    return {
      ik: fromBase64(el.getChildText('ik') ?? ''),
      spkId: Number(spk.attrs.id),
      spk: fromBase64(spk.text()),
      spkSignature: fromBase64(el.getChildText('spks') ?? ''),
      pkId: Number(pk.attrs.id),
      pk: fromBase64(pk.text()),
    };
  }


  private async trustOf(
    jid: string,
    id: number,
    ik: Uint8Array
  ): Promise<Trust> {
    const records =
      (await this.store.get<Record<number, DeviceRecord>>(trustKey(jid))) ?? {};
    const known = records[id];
    if (known && bytesEqual(known.ik, ik)) {return known.trust;}

    const hasVerified = Object.values(records).some(
      (r) => r.trust === 'verified'
    );
    const trust: Trust = known || hasVerified ? 'untrusted' : 'blind';
    records[id] = { ik, trust };
    await this.store.set(trustKey(jid), records);
    return trust;
  }

  devices(jid: string): Promise<DeviceInfo[]> {
    const target = bare(jid);
    return this.serial(async () => {
      const result: DeviceInfo[] = [];
      const listed = await this.fetchDeviceList(target);
      this.deviceLists.set(target, {
        ids: listed.map((d) => Number(d.attrs.id)),
        at: Date.now(),
      });
      for (const device of listed) {
        const id = Number(device.attrs.id);
        const label = device.attrs.label ? String(device.attrs.label) : undefined;
        if (target === this.jid && id === this.deviceId) {
          result.push({ id, fingerprint: this.fingerprint, trust: 'own', label });
          continue;
        }
        const records =
          (await this.store.get<Record<number, DeviceRecord>>(
            trustKey(target)
          )) ?? {};
        try {
          const ik = records[id]?.ik ?? (await this.fetchBundle(target, id)).ik;
          const trust = await this.trustOf(target, id, ik);
          result.push({ id, fingerprint: formatFingerprint(ik), trust, label });
        } catch (err) {
          console.warn(`OMEMO: no bundle for ${target}/${id}:`, err);
        }
      }
      return result;
    });
  }

  setTrust(jid: string, id: number, trust: Trust): Promise<void> {
    const target = bare(jid);
    return this.serial(async () => {
      const records =
        (await this.store.get<Record<number, DeviceRecord>>(
          trustKey(target)
        )) ?? {};
      const record = records[id];
      if (!record) {throw new Error('Unknown device');}
      record.trust = trust;
      await this.store.set(trustKey(target), records);
    });
  }

  private async encryptKey(
    jid: string,
    keyMaterial: Uint8Array
  ): Promise<Element[]> {
    const keys: Element[] = [];
    for (const id of await this.deviceIds(jid)) {
      if (jid === this.jid && id === this.deviceId) {continue;}
      try {
        let session = await this.store.get<Session>(sessionKey(jid, id));
        if (!session) {
          const bundle = await this.fetchBundle(jid, id);
          if ((await this.trustOf(jid, id, bundle.ik)) === 'untrusted') {
            continue;
          }
          session = initiateSession(this.keys.identity, bundle);
          await yieldToUi();
        } else if (
          (await this.trustOf(jid, id, session.peerIk)) === 'untrusted'
        ) {
          continue;
        }

        const [next, data] = ratchetEncrypt(session, keyMaterial);
        await this.store.set(sessionKey(jid, id), next);
        const kex = next.pendingKex;
        const encoded = kex
          ? encodeKeyExchange({
              ...kex,
              ik: this.keys.identity.pub,
              message: data,
            })
          : data;
        keys.push(
          xml(
            'key',
            { rid: String(id), kex: kex ? 'true' : undefined },
            toBase64(encoded)
          )
        );
      } catch (err) {
        console.warn(`OMEMO: skipping device ${jid}/${id}:`, err);
      }
    }
    return keys;
  }

  encryptGroupMessage(
    roomJid: string,
    members: string[],
    content: Element[],
    id: string,
    cleartext: Element[] = []
  ): Promise<Element> {
    return this.serial(async () => {
      const room = bare(roomJid);
      const recipients = Array.from(
        new Set([...members.map(bare), this.jid].filter(Boolean))
      );

      const envelope = xml(
        'envelope',
        { xmlns: NS_SCE },
        xml('content', {}, ...content),
        xml('rpad', {}, toBase64(randomBytes(randomInt(0, 48)))),
        xml('time', { stamp: new Date().toISOString() }),
        xml('to', { jid: room }),
        xml('from', { jid: this.jid })
      );
      const { keyMaterial, payload } = encryptPayload(
        utf8ToBytes(envelope.toString())
      );

      const blocks: Element[] = [];
      const unreachable: string[] = [];
      for (const jid of recipients) {
        let keys = await this.encryptKey(jid, keyMaterial);
        if (keys.length === 0 && jid !== this.jid) {
          this.deviceLists.delete(jid);
          keys = await this.encryptKey(jid, keyMaterial);
        }
        if (keys.length > 0) {
          blocks.push(xml('keys', { jid }, ...keys));
        } else if (jid !== this.jid) {
          unreachable.push(jid);
        }
      }
      if (blocks.length === 0) {
        throw new Error(
          `omemo_no_recipients: no published OMEMO device for ${
            unreachable.join(', ') || 'any member'
          } - they have to open the chat with encryption enabled at least once`
        );
      }

      const own: Decrypted = {
        content: content.map((c) => c.toString()).join(''),
        trust: 'own',
      };
      await this.store.set(messageKey(room, id), own);

      return xml(
        'message',
        { type: 'groupchat', to: room, id },
        xml(
          'encrypted',
          { xmlns: NS_OMEMO },
          xml('header', { sid: String(this.deviceId) }, ...blocks),
          xml('payload', {}, toBase64(payload))
        ),
        xml('encryption', {
          xmlns: 'urn:xmpp:eme:0',
          namespace: NS_OMEMO,
          name: 'OMEMO',
        }),
        xml('store', { xmlns: 'urn:xmpp:hints' }),
        xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id }),
        xml('body', {}, FALLBACK_BODY),
        ...cleartext
      );
    });
  }

  private async sendEmpty(jid: string, id: number) {
    const session = await this.store.get<Session>(sessionKey(jid, id));
    if (!session) {return;}
    const [next, data] = ratchetEncrypt(session, new Uint8Array(32));
    await this.store.set(sessionKey(jid, id), next);
    await this.xmpp.send(
      xml(
        'message',
        { type: 'chat', to: jid, id: `omemo-empty-${Date.now().toString(36)}` },
        xml(
          'encrypted',
          { xmlns: NS_OMEMO },
          xml(
            'header',
            { sid: String(this.deviceId) },
            xml(
              'keys',
              { jid },
              xml('key', { rid: String(id) }, toBase64(data))
            )
          )
        ),
        xml('no-permanent-store', { xmlns: 'urn:xmpp:hints' }),
        xml('no-copy', { xmlns: 'urn:xmpp:hints' }),
        xml('private', { xmlns: 'urn:xmpp:carbons:2' })
      )
    );
  }

  decrypt(
    el: Element,
    sender: string,
    roomJid: string
  ): Promise<Decrypted> | undefined {
    const encrypted = el.getChild('encrypted', NS_OMEMO);
    if (!encrypted) {return undefined;}
    const from = bare(sender);
    const room = bare(roomJid);

    return this.serial(async () => {
      const cacheId = el.attrs.id && messageKey(room, el.attrs.id);
      if (cacheId) {
        const cached = await this.store.get<Decrypted>(cacheId);
        if (cached) {return cached;}
      }
      const empty = !encrypted.getChild('payload');
      try {
        const result = await this.decryptUncached(encrypted, from, room);
        if (empty) {return { trust: result.trust };}
        if (cacheId && !result.error) {await this.store.set(cacheId, result);}
        return result;
      } catch (err) {
        if (empty) {return { trust: 'untrusted' };}
        console.warn('OMEMO: decryption failed:', err);
        return { trust: 'untrusted', error: 'omemo_decrypt_failed' };
      }
    });
  }

  private async decryptUncached(
    encrypted: Element,
    sender: string,
    roomJid: string
  ): Promise<Decrypted> {
    const header = encrypted.getChild('header');
    const sid = Number(header?.attrs.sid);
    if (!header || !Number.isInteger(sid)) {
      throw new Error('Invalid OMEMO header');
    }
    if (sender === this.jid && sid === this.deviceId) {
      return { trust: 'own', error: 'omemo_own_message_not_cached' };
    }

    const keyEl = header
      .getChildren('keys')
      .filter((k) => bare(k.attrs.jid ?? '') === this.jid)
      .flatMap((k) => k.getChildren('key'))
      .find((k) => Number(k.attrs.rid) === this.deviceId);
    if (!keyEl) {
      return {
        trust: 'untrusted',
        error: 'omemo_not_encrypted_for_this_device',
      };
    }

    const data = fromBase64(keyEl.text());
    const existing = await this.store.get<Session>(sessionKey(sender, sid));
    let session: Session;
    let keyMaterial: Uint8Array;
    let usedPrekey: number | undefined;

    if (keyEl.attrs.kex === 'true' || keyEl.attrs.kex === '1') {
      const kex = decodeKeyExchange(data);
      if (
        existing?.kexEk &&
        bytesEqual(existing.kexEk, kex.ek) &&
        bytesEqual(existing.peerIk, kex.ik)
      ) {
        [session, keyMaterial] = ratchetDecrypt(existing, kex.message);
      } else {
        const pk = this.keys.prekeys[kex.pkId];
        if (kex.spkId !== this.keys.spk.id || !pk) {
          throw new Error('Unknown prekey');
        }
        const accepted = acceptSession(
          this.keys.identity,
          this.keys.spk.pair,
          pk,
          kex.ik,
          kex.ek
        );
        [session, keyMaterial] = ratchetDecrypt(accepted, kex.message);
        usedPrekey = kex.pkId;
      }
    } else {
      if (!existing) {throw new Error('No session with the sender device');}
      [session, keyMaterial] = ratchetDecrypt(existing, data);
    }
    session.pendingKex = undefined;

    const payload = encrypted.getChildText('payload');
    const content = payload
      ? this.openEnvelope(
          decryptPayload(keyMaterial, fromBase64(payload)),
          sender,
          roomJid
        )
      : undefined;
    const trust = await this.trustOf(sender, sid, session.peerIk);
    await this.store.set(sessionKey(sender, sid), session);

    if (usedPrekey !== undefined) {
      await this.replacePrekey(usedPrekey);
      void this.serial(async () => {
        await this.publishBundle();
        await this.sendEmpty(sender, sid);
      }).catch((err) =>
        console.warn('OMEMO: failed to complete key exchange:', err)
      );
    }
    return { content, trust };
  }

  private openEnvelope(
    bytes: Uint8Array,
    sender: string,
    roomJid: string
  ): string {
    const envelope = parse(bytesToUtf8(bytes));
    if (!envelope.is('envelope', NS_SCE)) {
      throw new Error('Not an SCE envelope');
    }
    const from = envelope.getChild('from')?.attrs.jid;
    const to = envelope.getChild('to')?.attrs.jid;
    if (!from || bare(from) !== sender) {
      throw new Error('Envelope sender mismatch');
    }
    if (!to || bare(to) !== roomJid) {
      throw new Error('Envelope recipient mismatch');
    }
    return (envelope.getChild('content')?.children ?? [])
      .map((c) => (typeof c === 'string' ? c : (c as Element).toString()))
      .join('');
  }

  private async replacePrekey(id: number) {
    const keys = { ...this.keys, prekeys: { ...this.keys.prekeys } };
    delete keys.prekeys[id];
    keys.prekeys[keys.nextPrekeyId++] = generateKeyPair();
    await this.store.set('keys', keys);
    this.keys = keys;
  }
}
