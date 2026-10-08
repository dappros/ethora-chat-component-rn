/**
 * E2EE, phase 6 - what the user is shown and allowed around encryption:
 * the devices-and-fingerprints card, the trust mark, and the rule that an
 * encrypted message is not corrected in clear.
 */

jest.mock('../src/e2ee/deviceStore', () => {
  const { createMemoryBackend, createStore } = jest.requireActual('../src/e2ee/store');
  const backend = createMemoryBackend();
  return { openDeviceStore: async (jid: string) => createStore(backend, jid) };
});

const mockToast = jest.fn();
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: mockToast }),
}));

const mockCopy = jest.fn(async (_text: string) => {});
jest.mock('expo-clipboard', () => ({
  __esModule: true,
  setStringAsync: (text: string) => mockCopy(text),
}));

import React from 'react';
import { Alert } from 'react-native';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { fakeClient, type Pep } from './fixtures/fakePep';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { Omemo } from '../src/e2ee/omemo';
import { createMemoryStore } from '../src/e2ee/store';
import {
  __resetE2eeForTests,
  canEditMessage,
  omemoReady,
  onOnline,
  setE2eeEnabled,
} from '../src/e2ee';
import EncryptionCard from '../src/components/MainComponents/EncryptionCard';
import { accountNameOf } from '../src/helpers/accountName';
import type { IRoom } from '../src/types/types';

const DOMAIN = 'localhost';
const ME = `app_me@${DOMAIN}`;
const PEER = `app_peer@${DOMAIN}`;

const render = async (node: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{node}</Provider>);
  });
  return tree!;
};
const settle = async () => {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};
const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

async function start() {
  const pep: Pep = new Map();
  setE2eeEnabled(true);
  onOnline(fakeClient(pep, ME) as never);
  const me = (await omemoReady())!;
  await me.published();
  return { pep, me };
}

beforeEach(() => {
  __resetE2eeForTests();
  mockToast.mockReset();
  mockCopy.mockClear();
});
afterAll(() => __resetE2eeForTests());

describe('the devices card', () => {
  it('lists this device and the account\'s others, with labels and fingerprints', async () => {
    const { pep, me } = await start();
    const web = await Omemo.create(fakeClient(pep, ME) as never, ME, createMemoryStore(), { label: 'Web' });

    const tree = await render(<EncryptionCard />);
    await settle();
    const shown = text(tree);
    expect(shown).toContain('End-to-end encryption');
    expect(shown).toContain('This device');
    expect(shown).toContain('Web');
    // Both fingerprints, in full, split over two lines to be read out.
    const [first, second] = [me.fingerprint.split(' ').slice(0, 4).join(' '), me.fingerprint.split(' ').slice(4).join(' ')];
    expect(shown).toContain(first);
    expect(shown).toContain(second);
    expect(shown).toContain(web.fingerprint.split(' ')[0]);
    // One's own devices carry no trust mark: there is nothing to decide.
    expect(tree.root.findAll((n) => n.props?.testID === `e2ee-trust-${web.deviceId}`)).toHaveLength(0);

    // A tap copies the fingerprint for comparing.
    await act(async () => {
      tree.root.find((n) => n.props?.testID === `e2ee-device-${me.deviceId}` && n.props?.onPress).props.onPress();
    });
    expect(mockCopy).toHaveBeenCalledWith(me.fingerprint);
    await act(async () => tree.unmount());
  });

  it('says so when this is the account\'s only device', async () => {
    await start();
    const tree = await render(<EncryptionCard />);
    await settle();
    expect(text(tree)).toContain('This device');
    expect(text(tree)).toContain('No other devices');
    await act(async () => tree.unmount());
  });

  it("shows another person's devices with a trust mark, and changes it", async () => {
    const { pep, me } = await start();
    const peer = await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore(), { label: 'Web' });

    // Either spelling of the account works.
    const tree = await render(<EncryptionCard account="APP_peer@whatever" />);
    await settle();
    expect(text(tree)).toContain('Not verified');
    expect(text(tree)).toContain(peer.fingerprint.split(' ')[0]);
    expect(text(tree)).toContain('Compare a fingerprint');

    // The tap offers the two other states and shows what is being judged.
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => {
      tree.root.find((n) => n.props?.testID === `e2ee-device-${peer.deviceId}` && n.props?.onPress).props.onPress();
    });
    const [title, message, buttons] = alert.mock.calls[0]! as [string, string, any[]];
    expect(title).toContain(String(peer.deviceId));
    expect(message).toContain(peer.fingerprint);
    expect(buttons.map((b) => b.text)).toEqual(['Mark as verified', 'Stop trusting', 'Cancel']);

    await act(async () => {
      buttons[0].onPress();
    });
    await settle();
    expect(text(tree)).toContain('Verified');
    expect((await me.devices(PEER))[0]!.trust).toBe('verified');

    // Now the offer is to stop trusting or to clear the mark.
    await act(async () => {
      tree.root.find((n) => n.props?.testID === `e2ee-device-${peer.deviceId}` && n.props?.onPress).props.onPress();
    });
    const again = alert.mock.calls[1]![2] as any[];
    expect(again.map((b) => b.text)).toEqual(['Stop trusting', 'Clear the mark', 'Cancel']);
    await act(async () => {
      again[0].onPress();
    });
    await settle();
    expect(text(tree)).toContain('Not trusted');
    alert.mockRestore();
    await act(async () => tree.unmount());
  });

  it('says so when the person has never opened an encrypted chat', async () => {
    await start();
    const tree = await render(<EncryptionCard account="app_nobody" />);
    await settle();
    expect(text(tree)).toContain('Has not opened an encrypted chat yet');
    await act(async () => tree.unmount());
  });

  it('says encryption is not running rather than showing an empty list', async () => {
    // Enabled in config, but never connected - or the device store refused.
    const tree = await render(<EncryptionCard />);
    await settle();
    expect(text(tree)).toContain('Encryption is not running on this device right now');
    await act(async () => tree.unmount());
  });
});

describe('a device nobody verified, once one was', () => {
  it('is not encrypted for', async () => {
    const { pep, me } = await start();
    const first = await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore());
    await me.devices(PEER);
    await me.setTrust(PEER, first.deviceId, 'verified');

    // A second device appears on the account - the user's new laptop, or
    // somebody who got hold of the password.
    const second = await Omemo.create(fakeClient(pep, PEER) as never, PEER, createMemoryStore());
    const listed = await me.devices(PEER);
    expect(listed.find((d) => d.id === second.deviceId)!.trust).toBe('untrusted');

    const { xml } = require('@xmpp/client');
    const stanza = await me.encryptGroupMessage('r@conference.localhost', [ME, PEER], [xml('body', {}, 'x')], 'id-1', []);
    const rids = stanza
      .getChild('encrypted')!
      .getChild('header')!
      .getChildren('keys')
      .flatMap((k: any) => k.getChildren('key'))
      .map((k: any) => Number(k.attrs.rid));
    expect(rids).toContain(first.deviceId);
    expect(rids).not.toContain(second.deviceId);
  });
});

describe('editing in an encrypted room', () => {
  const SECRET = 'edit-secret@conference.localhost';
  const PLAIN = 'edit-plain@conference.localhost';
  beforeAll(() => {
    jest.useFakeTimers();
    for (const [jid, e2ee] of [[SECRET, true], [PLAIN, false]] as const) {
      store.dispatch(
        addRoom({
          roomData: { id: jid, jid, name: 'r', title: 'r', usersCnt: 2, messages: [], isLoading: false, roomBg: null, e2ee } as unknown as IRoom,
        })
      );
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('is refused for a message that went out encrypted, and only for that', () => {
    // The correction would travel in clear.
    expect(canEditMessage({ roomJid: SECRET })).toBe(false);
    // Sent in clear anyway: nothing left to protect.
    expect(canEditMessage({ roomJid: SECRET, unencrypted: true })).toBe(true);
    expect(canEditMessage({ roomJid: PLAIN })).toBe(true);
    expect(canEditMessage(undefined)).toBe(false);
  });
});

describe('accountNameOf', () => {
  it('finds the account wherever the screen put it', () => {
    // A message sender.
    expect(accountNameOf({ id: 'app_u1' }, 'app')).toBe('app_u1');
    // A room member from the REST list: only the bare user id.
    expect(accountNameOf({ userJID: 'u1', id: 'u1' }, 'app')).toBe('app_u1');
    // A full JID.
    expect(accountNameOf({ xmppUsername: 'app_u1@xmpp.host' }, 'other')).toBe('app_u1');
    expect(accountNameOf({ id: 'u1' }, '')).toBe('');
    expect(accountNameOf(undefined, 'app')).toBe('');
  });
});
