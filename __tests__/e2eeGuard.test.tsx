/**
 * E2EE, phase 0 - what an end-to-end encrypted room looks like in a build
 * that cannot encrypt or decrypt yet.
 *
 * The bugs this pins, all seen against a web client with OMEMO on:
 *   - an encrypted text rendered as the literal fallback "Encrypted
 *     message", as if somebody had typed it;
 *   - a sealed attachment (`application/octet-stream`) rendered as a dead
 *     audio player, in the bubble and in the room list;
 *   - the app sent plaintext into the room without anybody being told.
 */

// The players pull in native modules; a sealed attachment must never reach
// them anyway.
jest.mock('../src/components/styled/AudioMessage', () => 'AudioMessage');
jest.mock('../src/components/styled/VideoMessage', () => 'VideoMessage');

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { Element } from 'ltx';
import { store } from '../src/roomStore';
import { addRoom } from '../src/roomStore/roomsSlice';
import { NS_OMEMO, canSendToRoom, isE2eeRoom } from '../src/e2ee';
import { encryptedCarrier, rewriteEncryptedStanza } from '../src/e2ee/stanza';
import { createMessageFromXml } from '../src/helpers/createMessageFromXml';
import MediaMessage from '../src/components/MainComponents/MediaMessage';
import LastMessageItem from '../src/components/RoomComponents/LastMessageItem';
import ChatRoomItem from '../src/components/RoomComponents/ChatRoomItem';
import type { IRoom } from '../src/types/types';

const SECRET = 'secret@conference.host';
const PLAIN = 'plain@conference.host';

const makeRoom = (jid: string, e2ee: boolean): IRoom =>
  ({
    id: jid,
    name: jid.split('@')[0],
    jid,
    title: jid.split('@')[0],
    usersCnt: 2,
    messages: [],
    isLoading: false,
    roomBg: null,
    e2ee,
  } as IRoom);

beforeAll(() => {
  // Fake timers only around the dispatches, so the store's debounced
  // persistence does not outlive the suite.
  jest.useFakeTimers();
  store.dispatch(addRoom({ roomData: makeRoom(SECRET, true) }));
  store.dispatch(addRoom({ roomData: makeRoom(PLAIN, false) }));
  jest.clearAllTimers();
  jest.useRealTimers();
});

const el = (name: string, attrs: any = {}, ...children: Array<Element | string>) => {
  const node = new Element(name, attrs);
  children.forEach((child) =>
    typeof child === 'string' ? node.t(child) : node.append(child)
  );
  return node;
};

const omemoMessage = (opts: { payload?: boolean; data?: boolean } = {}) =>
  el(
    'message',
    { from: `${SECRET}/alice`, type: 'groupchat', id: 'm1' },
    el(
      'encrypted',
      { xmlns: NS_OMEMO },
      el('header', { sid: '1' }),
      ...(opts.payload === false ? [] : [el('payload', {}, 'AAAA')])
    ),
    el('body', {}, 'Encrypted message'),
    ...(opts.data === false
      ? []
      : [el('data', { senderJID: 'alice@host', senderFirstName: 'Alice' })])
  );

describe('encryptedCarrier', () => {
  it('finds the message itself', () => {
    const stanza = omemoMessage();
    expect(encryptedCarrier(stanza)).toBe(stanza);
  });

  it('looks through a MAM result and a mucsub event', () => {
    const inner = omemoMessage();
    const mam = el(
      'message',
      { from: SECRET },
      el('result', { id: '1' }, el('forwarded', {}, inner))
    );
    expect(encryptedCarrier(mam)).toBe(inner);

    const inner2 = omemoMessage();
    const mucsub = el(
      'message',
      { from: SECRET },
      el('event', {}, el('items', {}, el('item', {}, inner2)))
    );
    expect(encryptedCarrier(mucsub)).toBe(inner2);
  });

  it('ignores an ordinary message', () => {
    const plain = el('message', { from: `${PLAIN}/bob` }, el('body', {}, 'hi'));
    expect(encryptedCarrier(plain)).toBeUndefined();
  });
});

describe('rewriteEncryptedStanza', () => {
  it('leaves an ordinary message alone', () => {
    const plain = el('message', { from: `${PLAIN}/bob` }, el('body', {}, 'hi'));
    const before = plain.toString();
    expect(rewriteEncryptedStanza(plain)).toBe('not-encrypted');
    expect(plain.toString()).toBe(before);
  });

  it('drops session maintenance (no payload)', () => {
    expect(rewriteEncryptedStanza(omemoMessage({ payload: false }))).toBe('drop');
  });

  it('replaces the fallback body and marks the message', () => {
    const stanza = omemoMessage();
    expect(rewriteEncryptedStanza(stanza)).toBe('undecryptable');

    expect(stanza.getChild('encrypted', NS_OMEMO)).toBeUndefined();
    const body = stanza.getChild('body')!.getText();
    expect(body).not.toBe('Encrypted message');
    expect(body).toMatch(/can't read it yet/);

    // <data> rides in the clear and is the sender's own - kept, and stamped.
    const data = stanza.getChild('data')!;
    expect(data.attrs.senderFirstName).toBe('Alice');
    expect(data.attrs.omemoEncrypted).toBe('true');
    expect(data.attrs.undecryptable).toBe('true');

    // Nothing left to match a second time.
    expect(rewriteEncryptedStanza(stanza)).toBe('not-encrypted');
  });

  it('creates <data> for a sender that sealed it inside the envelope', () => {
    const stanza = omemoMessage({ data: false });
    rewriteEncryptedStanza(stanza);
    expect(stanza.getChild('data')!.attrs.omemoEncrypted).toBe('true');
  });
});

describe('messages in an encrypted room', () => {
  it('knows which rooms are encrypted', () => {
    expect(isE2eeRoom(SECRET)).toBe(true);
    expect(isE2eeRoom(`${SECRET}/alice`)).toBe(true);
    expect(isE2eeRoom(PLAIN)).toBe(false);
    expect(isE2eeRoom('unknown@conference.host')).toBe(false);
    expect(isE2eeRoom('')).toBe(false);
  });

  it('refuses to send into one', () => {
    expect(canSendToRoom(SECRET)).toBe(false);
    expect(canSendToRoom(PLAIN)).toBe(true);
  });

  it('marks what arrived in clear, and only there', async () => {
    const base = { id: '1', body: 'hi', date: '2026-10-05T10:00:00Z' };

    const clear = await createMessageFromXml({
      ...base,
      data: { senderJID: 'bob@host' },
      roomJid: SECRET,
    } as any);
    expect(clear.unencrypted).toBe(true);

    const protectedMessage = await createMessageFromXml({
      ...base,
      data: { senderJID: 'bob@host', omemoEncrypted: 'true' },
      roomJid: SECRET,
    } as any);
    expect(protectedMessage.unencrypted).toBeUndefined();

    const elsewhere = await createMessageFromXml({
      ...base,
      data: { senderJID: 'bob@host' },
      roomJid: PLAIN,
    } as any);
    expect(elsewhere.unencrypted).toBeUndefined();

    // The positional convention (MAM catch-up) takes the room from `from`.
    const positional = await createMessageFromXml(
      { senderJID: 'bob@host' } as any,
      'hi',
      '2',
      `${SECRET}/bob`,
      false
    );
    expect(positional.unencrypted).toBe(true);
  });
});

const render = async (node: React.ReactElement) => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<Provider store={store}>{node}</Provider>);
  });
  return tree!;
};

const text = (tree: renderer.ReactTestRenderer) => JSON.stringify(tree.toJSON());

describe('sealed attachments', () => {
  const sealed = {
    id: '9',
    body: 'media',
    roomJid: SECRET,
    date: '2026-10-05T10:00:00Z',
    user: { id: 'alice', name: 'Alice' },
    isMediafile: 'true',
    mimetype: 'application/octet-stream',
    location: 'https://files.host/abc.bin',
    clientEncrypted: 'true',
  } as any;

  it('render as an encrypted file, not as a voice message', async () => {
    const tree = await render(
      <MediaMessage
        mimeType={sealed.mimetype}
        location={sealed.location}
        message={sealed}
        isUser={false}
      />
    );
    expect(tree.root.findAllByProps({ testID: 'sealed-attachment' }).length).toBeGreaterThan(0);
    expect(text(tree)).toContain('Encrypted file');
  });

  it('preview as an encrypted file in the room list', async () => {
    const tree = await render(<LastMessageItem lastMessage={sealed} />);
    expect(text(tree)).toContain('Encrypted file');
  });
});

describe('room list', () => {
  it('shows a padlock on encrypted rooms only', async () => {
    const locked = await render(<ChatRoomItem chat={makeRoom(SECRET, true)} />);
    expect(locked.root.findAllByProps({ testID: 'room-e2ee-lock' }).length).toBeGreaterThan(0);

    const open = await render(<ChatRoomItem chat={makeRoom(PLAIN, false)} />);
    expect(open.root.findAllByProps({ testID: 'room-e2ee-lock' })).toHaveLength(0);
  });
});
