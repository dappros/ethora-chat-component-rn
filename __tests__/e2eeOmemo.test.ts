/**
 * E2EE, phase 2 - the device: its key store, the `Omemo` class (ported from
 * the web SDK, with that SDK's MUC round-trip tests) and the glue that
 * starts it when the host turns encryption on.
 *
 * The server's PEP storage is an in-memory stand-in shared by the fake
 * clients, so no ejabberd is needed.
 */

const mockMmkvStore = new Map<string, string>();
// The file is encrypted: opened with another key, what it held is gone.
const mockMmkv = {
  available: true,
  options: [] as any[],
  key: undefined as string | undefined,
};
jest.mock(
  'react-native-mmkv',
  () => ({
    MMKV: class {
      constructor(options: { id: string; encryptionKey?: string }) {
        if (!mockMmkv.available) {throw new Error('native module missing');}
        if (mockMmkv.options.length > 0 && mockMmkv.key !== options.encryptionKey) {
          mockMmkvStore.clear();
        }
        mockMmkv.key = options.encryptionKey;
        mockMmkv.options.push(options);
      }
      clearAll() {
        mockMmkvStore.clear();
      }
      getString(k: string) {
        return mockMmkvStore.get(k);
      }
      set(k: string, v: string) {
        mockMmkvStore.set(k, v);
      }
      delete(k: string) {
        mockMmkvStore.delete(k);
      }
    },
  }),
  { virtual: true }
);

import AsyncStorage from '@react-native-async-storage/async-storage';
import { xml } from '@xmpp/client';
import { fakeClient, type Pep } from './fixtures/fakePep';
import { __resetPersistCryptoKeyForTests } from '../src/helpers/persistCrypto';
import { Element } from 'ltx';
import { Omemo } from '../src/e2ee/omemo';
import {
  createMemoryBackend,
  createMemoryStore,
  createStore,
  decodeValue,
  encodeValue,
} from '../src/e2ee/store';
import {
  __resetDeviceStoreForTests,
  openDeviceStore,
} from '../src/e2ee/deviceStore';
import {
  __resetE2eeForTests,
  isE2eeEnabled,
  omemo,
  omemoReady,
  onOnline,
  senderJidFromMuc,
  setE2eeEnabled,
  stopOmemo,
} from '../src/e2ee';
import { bytesToUtf8, toHex } from '../src/e2ee/crypto';

const DOMAIN = 'localhost';
const ROOM = 'room1@conference.localhost';
const ALICE = `alice@${DOMAIN}`;
const BOB = `bob@${DOMAIN}`;
const NODE_DEVICES = 'urn:xmpp:omemo:2:devices';
const NODE_BUNDLES = 'urn:xmpp:omemo:2:bundles';

/** The encrypted half of a text message: the body, and nothing else. */
const content = (text: string) => [xml('body', {}, text)];

/** The half that travels in the clear, beside <encrypted>. */
const metadata = () => [
  xml('data', { xmlns: 'ethora', senderFirstName: 'Alice', fullName: 'Alice A' }),
];

async function twoMembers() {
  const pep: Pep = new Map();
  const aliceClient = fakeClient(pep, ALICE);
  const bobClient = fakeClient(pep, BOB);
  const alice = await Omemo.create(aliceClient as never, ALICE, createMemoryStore());
  const bob = await Omemo.create(bobClient as never, BOB, createMemoryStore());
  return { pep, alice, bob, aliceClient, bobClient };
}

describe('key store', () => {
  it('keeps byte arrays through the text encoding, at any depth', () => {
    const value = {
      deviceId: 7,
      identity: { seed: Uint8Array.of(1, 2, 3), pub: new Uint8Array(0) },
      prekeys: { 1: { priv: Uint8Array.of(255), pub: Uint8Array.of(0) } },
      list: [Uint8Array.of(9), 'text', null],
    };
    const restored = decodeValue<typeof value>(encodeValue(value));
    expect(restored).toEqual(value);
    expect(restored.identity.seed).toBeInstanceOf(Uint8Array);
    expect(restored.prekeys[1].priv).toBeInstanceOf(Uint8Array);
    expect(restored.list[0]).toBeInstanceOf(Uint8Array);
  });

  it('hands out copies, never the stored object', async () => {
    const store = createMemoryStore();
    const session = { rk: Uint8Array.of(1), skipped: {} as Record<string, Uint8Array> };
    await store.set('s', session);
    session.rk[0] = 9;

    const first = (await store.get<typeof session>('s'))!;
    expect(first.rk[0]).toBe(1);
    first.skipped.x = Uint8Array.of(1);
    expect((await store.get<typeof session>('s'))!.skipped.x).toBeUndefined();

    await store.delete('s');
    expect(await store.get('s')).toBeUndefined();
  });

  it('keeps accounts apart on a shared backend', async () => {
    const backend = createMemoryBackend();
    const alice = createStore(backend, 'Alice@Host');
    const bob = createStore(backend, 'bob@host');
    await alice.set('keys', { deviceId: 1 });
    expect(await bob.get('keys')).toBeUndefined();
    // The JID is case-insensitive; the slice must be too.
    expect(await createStore(backend, 'alice@host').get('keys')).toEqual({ deviceId: 1 });
  });
});

const secureStore = jest.requireMock('expo-secure-store') as any;
const resetDevice = async () => {
  mockMmkvStore.clear();
  mockMmkv.available = true;
  mockMmkv.options = [];
  mockMmkv.key = undefined;
  secureStore.__store.clear();
  __resetDeviceStoreForTests();
  __resetPersistCryptoKeyForTests();
  await AsyncStorage.clear();
};
/** A keychain that accepts a write and keeps nothing. */
const dropSecureWrites = () =>
  secureStore.setItemAsync.mockImplementation(async () => {
    throw new Error('keychain unavailable');
  });
const keepSecureWrites = () =>
  secureStore.setItemAsync.mockImplementation(async (key: string, value: string) => {
    if (!/^[\w.-]+$/.test(key)) {throw new Error('Invalid key provided to SecureStore.');}
    secureStore.__store.set(key, value);
  });

describe('device store', () => {
  beforeEach(resetDevice);
  afterEach(keepSecureWrites);

  it('lives in its own encrypted MMKV instance, apart from the chat cache', async () => {
    const store = await openDeviceStore(ALICE);
    await store.set('keys', { seed: Uint8Array.of(1, 2) });

    expect(mockMmkv.options).toHaveLength(1);
    expect(mockMmkv.options[0].id).toBe('ethora-omemo');
    expect(mockMmkv.options[0].encryptionKey).toMatch(/^[0-9a-f]{16}$/);
    // Logout wipes `@ethora/persist:` keys; nothing of ours may match.
    expect([...mockMmkvStore.keys()]).toEqual([`${ALICE}|keys`]);
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('@ethora/persist:'))).toEqual([]);

    // The key is kept under a name the secure store accepts...
    expect([...secureStore.__store.keys()]).toEqual(['ethora_omemo_store_key']);
    // ...so the next launch opens the same file and reads the identity back.
    __resetDeviceStoreForTests();
    expect(await (await openDeviceStore(ALICE)).get('keys')).toEqual({
      seed: Uint8Array.of(1, 2),
    });
    expect(mockMmkv.options[1].encryptionKey).toBe(mockMmkv.options[0].encryptionKey);
  });

  it('refuses to open when its key would not be there after a restart', async () => {
    // An identity lost on restart is minted again on restart: a new device
    // in the account's published list every time the app opens.
    dropSecureWrites();
    await expect(openDeviceStore(ALICE)).rejects.toThrow('was not kept');
    expect(mockMmkv.options).toHaveLength(0);

    // Same rule for the fallback path.
    mockMmkv.available = false;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(openDeviceStore(ALICE)).rejects.toThrow('was not kept');
    warn.mockRestore();

    // Not a permanent verdict: once the keychain works, so does the store.
    keepSecureWrites();
    mockMmkv.available = true;
    await expect(openDeviceStore(ALICE)).resolves.toBeDefined();
  });

  it('falls back to sealed AsyncStorage when MMKV is not in the binary', async () => {
    mockMmkv.available = false;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await openDeviceStore(ALICE);
    await store.set('keys', { seed: Uint8Array.of(7, 7, 7) });
    warn.mockRestore();

    const raw = await AsyncStorage.getItem(`@ethora/omemo:${ALICE}|keys`);
    expect(raw).toBeTruthy();
    // Sealed: the key bytes are not readable off the disk.
    expect(raw).not.toContain('BwcH');
    expect(await store.get('keys')).toEqual({ seed: Uint8Array.of(7, 7, 7) });
    await store.delete('keys');
    expect(await store.get('keys')).toBeUndefined();
  });
});

describe('utf-8 decoding without TextDecoder', () => {
  it('agrees with the platform on every plane', () => {
    const sample = 'ascii, кириллица, 中文, ✓, 🔐👨‍👩‍👧, \u0000 and ￿';
    expect(bytesToUtf8(new TextEncoder().encode(sample))).toBe(sample);
    const long = 'я🔐'.repeat(20000);
    expect(bytesToUtf8(new TextEncoder().encode(long))).toBe(long);
  });

  it('replaces what is not UTF-8 instead of throwing', () => {
    expect(bytesToUtf8(Uint8Array.of(0x61, 0xff, 0x62))).toBe('a�b');
    expect(bytesToUtf8(Uint8Array.of(0xc0, 0xaf))).toBe('��'); // overlong
    expect(bytesToUtf8(Uint8Array.of(0xed, 0xa0, 0x80))).toContain('�'); // surrogate
    expect(bytesToUtf8(Uint8Array.of(0xe2, 0x82))).toContain('�'); // cut short
  });
});

describe('a new device', () => {
  it('publishes its bundle and announces itself with a label', async () => {
    const pep: Pep = new Map();
    const client = fakeClient(pep, ALICE);
    const alice = await Omemo.create(client as never, ALICE, createMemoryStore(), {
      label: 'iOS',
    });

    const bundle = pep.get(ALICE)!.get(NODE_BUNDLES)!.get(String(alice.deviceId))!;
    expect(bundle.getChildren('prekeys')[0]!.getChildren('pk')).toHaveLength(100);
    expect(bundle.getChild('spk')!.attrs.id).toBe('1');
    expect(bundle.getChildText('ik')).toBeTruthy();

    const devices = pep.get(ALICE)!.get(NODE_DEVICES)!.get('current')!;
    const mine = devices.getChildren('device').find(
      (d) => d.attrs.id === String(alice.deviceId)
    )!;
    expect(mine.attrs.label).toBe('iOS');
    expect(alice.fingerprint).toMatch(/^([0-9a-f]{8} ){7}[0-9a-f]{8}$/);

    // Other members must be able to read both nodes.
    const publishes = client.requests.filter((iq) =>
      iq.getChild('pubsub')?.getChild('publish')
    );
    for (const iq of publishes) {
      expect(iq.toString()).toContain('pubsub#access_model');
      expect(iq.toString()).toContain('<value>open</value>');
    }
  });

  it('is the same device on the next launch, and keeps other devices listed', async () => {
    const pep: Pep = new Map();
    const store = createMemoryStore();
    const first = await Omemo.create(fakeClient(pep, ALICE) as never, ALICE, store);
    // Another device of the same account, e.g. the web client.
    const other = await Omemo.create(
      fakeClient(pep, ALICE) as never,
      ALICE,
      createMemoryStore(),
      { label: 'Web' }
    );

    const again = await Omemo.create(fakeClient(pep, ALICE) as never, ALICE, store);
    expect(again.deviceId).toBe(first.deviceId);
    expect(again.fingerprint).toBe(first.fingerprint);

    const listed = pep
      .get(ALICE)!
      .get(NODE_DEVICES)!
      .get('current')!
      .getChildren('device')
      .map((d) => `${d.attrs.id}:${d.attrs.label}`)
      .sort();
    expect(listed).toEqual(
      [`${first.deviceId}:Mobile`, `${other.deviceId}:Web`].sort()
    );
  });

  it('reports the devices of an account, its own marked as such', async () => {
    const { alice, bob } = await twoMembers();
    const own = await alice.devices(ALICE);
    expect(own).toEqual([
      { id: alice.deviceId, fingerprint: alice.fingerprint, trust: 'own', label: 'Mobile' },
    ]);
    const theirs = await alice.devices(BOB);
    expect(theirs).toEqual([
      { id: bob.deviceId, fingerprint: bob.fingerprint, trust: 'blind', label: 'Mobile' },
    ]);

    await alice.setTrust(BOB, bob.deviceId, 'verified');
    expect((await alice.devices(BOB))[0]!.trust).toBe('verified');
    await expect(alice.setTrust(BOB, 12345, 'verified')).rejects.toThrow('Unknown device');
  });
});

describe('OMEMO 2 in a MUC room', () => {
  it('encrypts to every member and decrypts back to the original children', async () => {
    const { alice, bob } = await twoMembers();

    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('hello room'),
      'msg-1',
      metadata()
    );

    expect(stanza.attrs.type).toBe('groupchat');
    expect(stanza.attrs.to).toBe(ROOM);
    // The id has to survive, or the sender's optimistic bubble never matches
    // the echo the room sends back
    expect(stanza.attrs.id).toBe('msg-1');

    const decrypted = await bob.decrypt(stanza, ALICE, ROOM);
    expect(decrypted?.error).toBeUndefined();
    expect(decrypted?.content).toContain('hello room');
    // The envelope holds the body and only the body. <data> is not in it -
    // it came through in the clear, as a sibling of <encrypted>.
    expect(decrypted?.content).not.toContain('senderFirstName');
    expect(stanza.getChild('data')?.attrs.senderFirstName).toBe('Alice');
  });

  it('hides the text on the wire, and nothing else', async () => {
    const { alice } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('top secret'),
      'msg-2',
      metadata()
    );

    const wire = stanza.toString();
    expect(wire).not.toContain('top secret');
    // Everything in <data> is plaintext on the wire: the server needs it to
    // build notifications. OMEMO here protects the message text, not who
    // sent it, to which room, or whom it mentions.
    expect(wire).toContain('senderFirstName="Alice"');
    expect(wire).toContain('fullName="Alice A"');
  });

  it('addresses one <keys> block per member', async () => {
    const { alice } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('hi'),
      'msg-3',
      metadata()
    );

    const blocks = stanza
      .getChild('encrypted')!
      .getChild('header')!
      .getChildren('keys');
    // Alice's own devices get a block too, but this device is excluded from
    // it, so with a single device of her own only Bob's block carries keys
    expect(blocks.map((b) => b.attrs.jid)).toEqual([BOB]);
  });

  it('throws when no member has a published device', async () => {
    const pep: Pep = new Map();
    const alice = await Omemo.create(
      fakeClient(pep, ALICE) as never,
      ALICE,
      createMemoryStore()
    );

    // Encrypting to nobody is not a thing: this must throw rather than build
    // a keyless stanza.
    await expect(
      alice.encryptGroupMessage(ROOM, [ALICE, BOB], content('hi'), 'msg-4', metadata())
    ).rejects.toThrow('omemo_no_recipients');
  });

  it('rejects a message replayed into a different room', async () => {
    const { alice, bob } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('hi'),
      'msg-5',
      metadata()
    );

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const decrypted = await bob.decrypt(stanza, ALICE, 'other@conference.localhost');
    warn.mockRestore();
    expect(decrypted?.error).toBe('omemo_decrypt_failed');
    expect(decrypted?.content).toBeUndefined();
  });

  it("rejects a message replayed under someone else's nick", async () => {
    const { alice, bob } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('hi'),
      'msg-6',
      metadata()
    );

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const decrypted = await bob.decrypt(stanza, `mallory@${DOMAIN}`, ROOM);
    warn.mockRestore();
    expect(decrypted?.content).toBeUndefined();
  });

  it("returns the cached plaintext for the room's echo of our own message", async () => {
    const { alice } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('my own words'),
      'msg-7',
      metadata()
    );

    // A MUC reflects the message back to its sender, but we deliberately do
    // not encrypt to this device - the echo is resolved from the local cache
    const echo = await alice.decrypt(stanza, ALICE, ROOM);
    expect(echo?.trust).toBe('own');
    expect(echo?.content).toContain('my own words');
  });

  it('decrypts the same archived message twice', async () => {
    const { alice, bob } = await twoMembers();
    const stanza = await alice.encryptGroupMessage(
      ROOM,
      [ALICE, BOB],
      content('from history'),
      'msg-8',
      metadata()
    );

    const live = await bob.decrypt(stanza, ALICE, ROOM);
    // Message keys are single-use, so a second delivery (MAM, mucsub replay)
    // can only work off the cache
    const replay = await bob.decrypt(stanza, ALICE, ROOM);
    expect(live?.content).toContain('from history');
    expect(replay?.content).toBe(live?.content);
  });

  it('ignores stanzas without an OMEMO payload', async () => {
    const { bob } = await twoMembers();
    expect(bob.decrypt(xml('message', { id: 'x' }), ALICE, ROOM)).toBeUndefined();
  });

  it('completes the key exchange: a used prekey is replaced and the sender told', async () => {
    const { pep, alice, bob, bobClient } = await twoMembers();
    const prekeyIds = () =>
      pep
        .get(BOB)!
        .get(NODE_BUNDLES)!
        .get(String(bob.deviceId))!
        .getChild('prekeys')!
        .getChildren('pk')
        .map((pk) => Number(pk.attrs.id));
    expect(prekeyIds()).not.toContain(101);

    const first = await alice.encryptGroupMessage(ROOM, [ALICE, BOB], content('one'), 'k-1', metadata());
    const key = first.getChild('encrypted')!.getChild('header')!.getChild('keys')!.getChild('key')!;
    expect(key.attrs.kex).toBe('true');
    expect((await bob.decrypt(first, ALICE, ROOM))?.content).toContain('one');

    // The follow-up runs after the decrypt task: wait for it through the
    // same queue the instance serialises its work on.
    await bob.devices(BOB);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await bob.devices(BOB);

    // One prekey consumed, a fresh one (id 101) published in its place.
    expect(prekeyIds()).toHaveLength(100);
    expect(prekeyIds()).toContain(101);
    // ...and an empty message went straight to Alice's device, not the room.
    const empty = bobClient.sent.find((s) => s.attrs.type === 'chat')!;
    expect(empty.attrs.to).toBe(ALICE);
    expect(empty.getChild('encrypted')!.getChild('payload')).toBeUndefined();

    // Once Alice has read it, she stops repeating the key exchange.
    await alice.decrypt(empty, BOB, ROOM);
    const second = await alice.encryptGroupMessage(ROOM, [ALICE, BOB], content('two'), 'k-2', metadata());
    const key2 = second.getChild('encrypted')!.getChild('header')!.getChild('keys')!.getChild('key')!;
    expect(key2.attrs.kex).toBeUndefined();
    expect((await bob.decrypt(second, ALICE, ROOM))?.content).toContain('two');
  });

  it('keeps a conversation going both ways, with non-ASCII text', async () => {
    const { alice, bob } = await twoMembers();
    for (let round = 0; round < 4; round++) {
      const out = await alice.encryptGroupMessage(ROOM, [ALICE, BOB], content(`привет ${round} 🔐`), `a-${round}`, metadata());
      expect((await bob.decrypt(out, ALICE, ROOM))?.content).toContain(`привет ${round} 🔐`);
      const back = await bob.encryptGroupMessage(ROOM, [ALICE, BOB], content(`reply ${round}`), `b-${round}`, metadata());
      expect((await alice.decrypt(back, BOB, ROOM))?.content).toContain(`reply ${round}`);
    }
  });

  it('survives a reconnect: a new client, the same device and sessions', async () => {
    const { pep, alice, bob } = await twoMembers();
    const before = await alice.encryptGroupMessage(ROOM, [ALICE, BOB], content('before'), 'r-1', metadata());
    expect((await bob.decrypt(before, ALICE, ROOM))?.content).toContain('before');

    const fresh = fakeClient(pep, ALICE);
    alice.useClient(fresh as never);
    const after = await alice.encryptGroupMessage(ROOM, [ALICE, BOB], content('after'), 'r-2', metadata());
    expect((await bob.decrypt(after, ALICE, ROOM))?.content).toContain('after');
  });
});

describe('PEP node repair', () => {
  /**
   * A server whose bundles node already exists with a configuration that our
   * publish-options cannot satisfy - what a change to `max_items_node` does
   * to every account that already published.
   */
  function pickyClient(pep: Pep, jid: string, failures: { count: number }) {
    const base = fakeClient(pep, jid);
    return {
      ...base,
      iqCaller: {
        request: async (iq: Element) => {
          const owner = iq.getChild('pubsub', 'http://jabber.org/protocol/pubsub#owner');
          if (owner?.getChild('configure')) {
            // Reconfiguring the node is what makes the publish work again
            failures.count = 0;
            return xml('iq', { type: 'result' });
          }
          const publish = iq.getChild('pubsub')?.getChild('publish');
          if (publish?.attrs.node === NODE_BUNDLES && failures.count > 0) {
            failures.count--;
            throw Object.assign(new Error('precondition-not-met'), {
              condition: 'precondition-not-met',
            });
          }
          return base.iqCaller.request(iq);
        },
      },
    };
  }

  it('reconfigures a node that rejects our publish-options', async () => {
    const pep: Pep = new Map();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const device = await Omemo.create(
      pickyClient(pep, ALICE, { count: 1 }) as never,
      ALICE,
      createMemoryStore()
    );
    warn.mockRestore();
    expect(pep.get(ALICE)?.get(NODE_BUNDLES)?.has(String(device.deviceId))).toBe(true);
  });

  it('gives up on an error it cannot repair', async () => {
    const pep: Pep = new Map();
    const broken = {
      ...fakeClient(pep, ALICE),
      iqCaller: {
        request: async () => {
          throw Object.assign(new Error('forbidden'), { condition: 'forbidden' });
        },
      },
    };
    await expect(
      Omemo.create(broken as never, ALICE, createMemoryStore())
    ).rejects.toThrow('forbidden');
  });
});

describe('senderJidFromMuc', () => {
  it('resolves the room nick to the account it belongs to', () => {
    expect(senderJidFromMuc(`${ROOM}/alice`, DOMAIN)).toBe(ALICE);
  });

  it('has no answer for a bare room JID', () => {
    expect(senderJidFromMuc(ROOM, DOMAIN)).toBeUndefined();
    expect(senderJidFromMuc(undefined, DOMAIN)).toBeUndefined();
  });
});

describe('starting with the session', () => {
  beforeEach(async () => {
    __resetE2eeForTests();
    await resetDevice();
  });
  afterEach(keepSecureWrites);
  afterAll(() => __resetE2eeForTests());

  it('creates no device at all when the store cannot keep it', async () => {
    const pep: Pep = new Map();
    const client = fakeClient(pep, ALICE);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    dropSecureWrites();
    setE2eeEnabled(true);
    onOnline(client as never);
    expect(await omemoReady()).toBeUndefined();
    warn.mockRestore();
    // Nothing published: no bundle, no entry in the device list.
    expect(client.requests).toHaveLength(0);
    expect(pep.size).toBe(0);
  });

  it('does nothing at all while the host has not enabled it', async () => {
    const pep: Pep = new Map();
    const client = fakeClient(pep, ALICE);
    onOnline(client as never);
    expect(await omemoReady()).toBeUndefined();
    expect(omemo()).toBeUndefined();
    expect(client.requests).toHaveLength(0);
    expect(mockMmkvStore.size).toBe(0);
  });

  it('starts whichever comes second, the flag or the connection', async () => {
    const pep: Pep = new Map();
    setE2eeEnabled(true);
    expect(isE2eeEnabled()).toBe(true);
    expect(await omemoReady()).toBeUndefined(); // not connected yet

    onOnline(fakeClient(pep, ALICE) as never);
    const device = await omemoReady();
    expect(device?.jid).toBe(ALICE);
    expect(omemo()).toBe(device);
    // Usable as soon as the keys are in hand; the publish follows behind.
    expect(await device!.published()).toBe(true);
    expect(pep.get(ALICE)?.get(NODE_BUNDLES)?.has(String(device!.deviceId))).toBe(true);

    // The other order: connected first, enabled later.
    __resetE2eeForTests();
    onOnline(fakeClient(pep, ALICE) as never);
    setE2eeEnabled(true);
    expect((await omemoReady())?.deviceId).toBe(device!.deviceId);
  });

  it('keeps the device across a reconnect and across a logout', async () => {
    const pep: Pep = new Map();
    setE2eeEnabled(true);
    onOnline(fakeClient(pep, ALICE) as never);
    const device = (await omemoReady())!;
    await device.published();

    // Reconnect: a new client, the same instance, nothing republished.
    const second = fakeClient(pep, ALICE);
    onOnline(second as never);
    expect(await omemoReady()).toBe(device);
    expect(second.requests).toHaveLength(0);

    // Logout drops the instance but not the keys - and neither does an
    // app restart in between.
    stopOmemo();
    expect(omemo()).toBeUndefined();
    __resetDeviceStoreForTests();
    onOnline(fakeClient(pep, ALICE) as never);
    const back = (await omemoReady())!;
    expect(back).not.toBe(device);
    expect(back.deviceId).toBe(device.deviceId);
    expect(back.fingerprint).toBe(device.fingerprint);
  });

  it('gives each account on the device its own identity', async () => {
    const pep: Pep = new Map();
    setE2eeEnabled(true);
    onOnline(fakeClient(pep, ALICE) as never);
    const alice = (await omemoReady())!;
    stopOmemo();
    onOnline(fakeClient(pep, BOB) as never);
    const bob = (await omemoReady())!;
    expect(bob.jid).toBe(BOB);
    expect(bob.fingerprint).not.toBe(alice.fingerprint);
  });

  it('discards a start that a logout overtook', async () => {
    const pep: Pep = new Map();
    setE2eeEnabled(true);
    onOnline(fakeClient(pep, ALICE) as never);
    const pending = omemoReady();
    stopOmemo();
    expect(await pending).toBeUndefined();
    expect(omemo()).toBeUndefined();
  });

  it('reads without the server, and announces itself on the next connect', async () => {
    const pep: Pep = new Map();
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    setE2eeEnabled(true);
    onOnline({
      ...fakeClient(pep, ALICE),
      iqCaller: {
        request: async () => {
          throw Object.assign(new Error('forbidden'), { condition: 'forbidden' });
        },
      },
    } as never);
    // The keys do not depend on the server: the device exists and can read.
    // It just is not announced yet.
    const device = (await omemoReady())!;
    expect(device.jid).toBe(ALICE);
    expect(await device.published()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    expect(pep.size).toBe(0);

    onOnline(fakeClient(pep, ALICE) as never);
    expect(await omemoReady()).toBe(device);
    expect(await device.published()).toBe(true);
    expect(pep.get(ALICE)?.get(NODE_BUNDLES)?.has(String(device.deviceId))).toBe(true);
  });
});

// Keeps `toHex` honest as an import: fingerprints are its only consumer here.
test('fingerprint is the identity key in hex', async () => {
  const pep: Pep = new Map();
  const device = await Omemo.create(fakeClient(pep, ALICE) as never, ALICE, createMemoryStore());
  const ik = pep.get(ALICE)!.get(NODE_BUNDLES)!.get(String(device.deviceId))!.getChildText('ik')!;
  expect(device.fingerprint.replace(/ /g, '')).toBe(toHex(Buffer.from(ik, 'base64')));
});
