/**
 * Async translation (mod_translate `translate_mode: async`).
 *
 * The server delivers a room message at once, untranslated, and marks the
 * live copy `<translation-pending xmlns="ethora:translate"/>`. Once the
 * translation service answers, the room sends every occupant online:
 *
 *   <message type="headline" from="room@conference.host">
 *     <translation-update xmlns="ethora:translate" id="ARCHIVE_ID"
 *         xmppId="SENDER_ID" status="done|failed" value="JSON"/>
 *
 * Until it lands the bubble says "Translating…" (auto mode inline, manual
 * mode once the link is tapped); then the translation takes its place
 * without a reload.
 */
jest.mock('../src/helpers/userResolver', () => ({
  getUserLookupStatus: () => 'resolved',
  requestUsers: jest.fn(),
  subscribeUserResolver: () => () => {},
}));
jest.mock('../src/components/MainComponents/MediaMessage', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../src/components/MessageBubble/MessageInteractions', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('expo-clipboard', () => ({ __esModule: true, setStringAsync: jest.fn() }));
jest.mock('../src/context/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('../src/context/xmppProvider', () => ({
  useXmppClient: () => ({ client: { sendMessageReactionStanza: jest.fn() } }),
}));
jest.mock('react-native-gesture-handler', () => {
  const chain: any = new Proxy({}, { get: () => () => chain });
  return {
    Gesture: new Proxy({}, { get: () => () => chain }),
    GestureDetector: ({ children }: any) => children,
  };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { Element } from 'ltx';
import { store } from '../src/roomStore';
import {
  addRoom,
  addRoomMessage,
  setLogoutState,
} from '../src/roomStore/roomsSlice';
import { setConfig, setUser } from '../src/roomStore/chatSettingsSlice';
import { handleStanza } from '../src/networking/xmpp/handleStanzas.xmpp';
import { getDataFromXml } from '../src/helpers/getDataFromXml';
import {
  TRANSLATION_PENDING_MAX_AGE_MS,
  useMessageTranslation,
  useRerenderAt,
  MessageTranslationState,
} from '../src/hooks/useMessageTranslation';
import MessageTranslate from '../src/components/MessageBubble/MessageTranslate';
import { Message } from '../src/components/MessageBubble/Message';
import { IConfig, IRoom } from '../src/types/types';

const APP = '646cc8dc96d4a4dc8f7b2f2d';
const ME = `${APP}_6a2718bcef26ca2d3e1b78c3`;
const THEM = `${APP}_6a46007ce7b43f307b6da578`;
const ROOM = `${APP}_6f0a1c2e-3d4b-5a6f-8b9c-0d1e2f3a4b5c@conference.example.com`;
const READER = 'fr-CA';
const TEXT = 'hello everyone, see you tomorrow';
const FRENCH = 'bonjour à tous, à demain';

// A MAM / stanza id: the 13-digit millisecond time, then microseconds.
const archiveIdAt = (ms: number) => `${ms}123`;

const TRANSLATIONS_JSON = JSON.stringify({
  translates: [
    { translatedText: TEXT, language: 'en-CA', languageName: 'Canadian English' },
    { translatedText: FRENCH, language: 'fr-CA', languageName: 'Canadian French' },
  ],
});

const fakeXmpp = { username: ME } as any;

const liveStanza = (archiveId: string, { pending = true } = {}) => {
  const msg = new Element('message', {
    from: `${ROOM}/${THEM}`,
    to: `${ME}@example.com/r`,
    type: 'groupchat',
    id: 'msg-1',
  });
  msg.c('body').t(TEXT);
  msg.c('translate', { source: 'en' });
  msg.c('stanza-id', { xmlns: 'urn:xmpp:sid:0', by: ROOM, id: archiveId });
  if (pending) {msg.c('translation-pending', { xmlns: 'ethora:translate' });}
  return msg;
};

const updateStanza = (
  attrs: Record<string, string>,
  { from = ROOM, type = 'headline' }: { from?: string; type?: string } = {}
) => {
  const msg = new Element('message', {
    from,
    to: `${ME}@example.com/r`,
    type,
    id: 'translation-1',
  });
  msg.c('translation-update', { xmlns: 'ethora:translate', ...attrs });
  return msg;
};

// The edit of a message as the room relays it (mod_edit), with what it
// says about the translations of the new text.
const editStanza = (
  archiveId: string,
  text: string,
  mark: 'pending' | 'translations' | 'none'
) => {
  const msg = new Element('message', {
    from: `${ROOM}/${THEM}`,
    to: `${ME}@example.com/r`,
    type: 'groupchat',
    id: 'edit-message-1',
  });
  msg.c('replace', { id: archiveId, text });
  msg.c('stanza-id', { xmlns: 'urn:xmpp:sid:0', by: ROOM, id: archiveIdAt(Date.now() + 1) });
  if (mark === 'pending') {msg.c('translation-pending', { xmlns: 'ethora:translate' });}
  if (mark === 'translations') {msg.c('translations', { value: EDITED_TRANSLATIONS_JSON });}
  return msg;
};

const EDITED = 'hello everyone, see you on Friday';
const EDITED_FRENCH = 'bonjour à tous, à vendredi';
const EDITED_TRANSLATIONS_JSON = JSON.stringify({
  translates: [
    { translatedText: EDITED, language: 'en-CA', languageName: 'Canadian English' },
    { translatedText: EDITED_FRENCH, language: 'fr-CA', languageName: 'Canadian French' },
  ],
});

const pendingMessage = (archiveId: string, over: Record<string, unknown> = {}) =>
  ({
    id: archiveId,
    xmppId: 'msg-1',
    body: TEXT,
    langSource: 'en',
    translationPending: true,
    roomJid: ROOM,
    date: new Date(Number(archiveId.slice(0, 13))).toISOString(),
    user: { id: THEM, name: 'John' },
    ...over,
  }) as any;

const messageInStore = (id: string) =>
  (store.getState().rooms.rooms[ROOM]?.messages || []).find(
    (m: any) => m.id === id
  ) as any;

const resetStore = async (config: Partial<IConfig> = {}) => {
  await act(async () => {
    store.dispatch(setLogoutState());
    store.dispatch(setConfig({ translates: { enabled: true, readerLocale: READER }, ...config } as any));
    store.dispatch(setUser({ xmppUsername: ME } as any));
    store.dispatch(addRoom({ roomData: { jid: ROOM, name: 'r', title: 'r' } as IRoom }));
  });
};

const textsOf = (tree: renderer.ReactTestRenderer): string[] =>
  tree.root
    .findAllByType(Text)
    .map((n) =>
      (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
        .filter((c: unknown) => typeof c === 'string')
        .join('')
    )
    .filter(Boolean);

describe('the live copy carries the pending mark', () => {
  it('parses <translation-pending/> off a live message', async () => {
    const parsed = await getDataFromXml(liveStanza(archiveIdAt(Date.now())));
    expect(parsed?.translationPending).toBe(true);
    expect(parsed?.translations).toBeUndefined();
  });

  it('a message without the mark (sync server, archive copy) is not pending', async () => {
    const parsed = await getDataFromXml(
      liveStanza(archiveIdAt(Date.now()), { pending: false })
    );
    expect(parsed?.translationPending).toBeUndefined();
  });

  it('ignores the mark in another namespace', async () => {
    const msg = liveStanza(archiveIdAt(Date.now()), { pending: false });
    msg.c('translation-pending');
    expect((await getDataFromXml(msg))?.translationPending).toBeUndefined();
  });
});

describe('<translation-update/> from the room', () => {
  beforeEach(() => resetStore());

  it('attaches the translation to the message, matched by its archive id', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: pendingMessage(id) }));

    handleStanza(
      updateStanza({ id, xmppId: 'msg-1', status: 'done', value: TRANSLATIONS_JSON }),
      fakeXmpp
    );

    const msg = messageInStore(id);
    expect(msg.translations['fr-CA'].translatedText).toBe(FRENCH);
    expect(msg.translationPending).toBe(false);
  });

  it('matches by the sender’s id when the archive id is not known', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: pendingMessage(id) }));

    handleStanza(
      updateStanza({ xmppId: 'msg-1', status: 'done', value: TRANSLATIONS_JSON }),
      fakeXmpp
    );

    expect(messageInStore(id).translations['fr-CA'].translatedText).toBe(FRENCH);
  });

  it('a failed translation ends the pending state and attaches nothing', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: pendingMessage(id) }));

    handleStanza(updateStanza({ id, xmppId: 'msg-1', status: 'failed' }), fakeXmpp);

    const msg = messageInStore(id);
    expect(msg.translationPending).toBe(false);
    expect(msg.translations).toBeUndefined();
  });

  it('ignores an update that does not come from the room itself', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: pendingMessage(id) }));

    // An occupant (full jid) or a plain user must not be able to rewrite a
    // room's messages.
    handleStanza(
      updateStanza(
        { id, status: 'done', value: TRANSLATIONS_JSON },
        { from: `${ROOM}/${THEM}` }
      ),
      fakeXmpp
    );
    handleStanza(
      updateStanza(
        { id, status: 'done', value: TRANSLATIONS_JSON },
        { from: `${THEM}@example.com` }
      ),
      fakeXmpp
    );

    const msg = messageInStore(id);
    expect(msg.translations).toBeUndefined();
    expect(msg.translationPending).toBe(true);
  });

  it('keeps a translation that arrives before its message, for the message', async () => {
    const id = archiveIdAt(Date.now());
    handleStanza(
      updateStanza({ id, xmppId: 'msg-1', status: 'done', value: TRANSLATIONS_JSON }),
      fakeXmpp
    );
    expect(messageInStore(id)).toBeUndefined();

    // e.g. a history page that was in flight when the update came
    store.dispatch(
      addRoomMessage({
        roomJID: ROOM,
        message: pendingMessage(id, { translationPending: undefined }),
      })
    );

    expect(messageInStore(id).translations['fr-CA'].translatedText).toBe(FRENCH);
    expect(store.getState().rooms.pendingTranslations?.[ROOM]?.[id]).toBeUndefined();
  });

  it('the live message path picks up the pending mark', async () => {
    const id = archiveIdAt(Date.now());
    const data = liveStanza(id);
    data.c('data', { senderJID: `${THEM}@example.com`, senderFirstName: 'John' });
    const { onRealtimeMessage } = require('../src/networking/stanzaHandlers');
    await onRealtimeMessage(data, fakeXmpp);

    expect(messageInStore(id)?.translationPending).toBe(true);
  });
});

describe('an edit', () => {
  beforeEach(() => resetStore());

  const translatedMessage = (id: string) =>
    pendingMessage(id, {
      translationPending: undefined,
      translations: {
        'fr-CA': { translatedText: FRENCH, language: 'fr-CA', languageName: 'Canadian French' },
      },
    });

  it('async server: the old translation goes, "Translating…", then the new one', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: translatedMessage(id) }));

    handleStanza(editStanza(id, EDITED, 'pending'), fakeXmpp);

    let msg = messageInStore(id);
    expect(msg.body).toBe(EDITED);
    expect(msg.isEdited).toBe(true);
    expect(msg.translations).toBeUndefined();
    expect(msg.translationPending).toBe(true);
    expect(msg.translationPendingSince).toBeGreaterThan(Date.now() - 5000);

    handleStanza(
      updateStanza({ id, xmppId: 'msg-1', status: 'done', value: EDITED_TRANSLATIONS_JSON }),
      fakeXmpp
    );

    msg = messageInStore(id);
    expect(msg.translations['fr-CA'].translatedText).toBe(EDITED_FRENCH);
    expect(msg.translationPending).toBe(false);
  });

  it('an edit while the first translation is still running waits for its own', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: pendingMessage(id) }));

    handleStanza(editStanza(id, EDITED, 'pending'), fakeXmpp);
    expect(messageInStore(id).translationPending).toBe(true);

    handleStanza(updateStanza({ id, xmppId: 'msg-1', status: 'failed' }), fakeXmpp);
    const msg = messageInStore(id);
    expect(msg.body).toBe(EDITED);
    expect(msg.translations).toBeUndefined();
    expect(msg.translationPending).toBe(false);
  });

  it('sync server: the translations of the new text come with the edit', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: translatedMessage(id) }));

    handleStanza(editStanza(id, EDITED, 'translations'), fakeXmpp);

    const msg = messageInStore(id);
    expect(msg.body).toBe(EDITED);
    expect(msg.translations['fr-CA'].translatedText).toBe(EDITED_FRENCH);
    expect(msg.translationPending).toBe(false);
  });

  it('nothing about translations (older server, failed): the old one is dropped', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: translatedMessage(id) }));

    handleStanza(editStanza(id, EDITED, 'none'), fakeXmpp);

    const msg = messageInStore(id);
    expect(msg.body).toBe(EDITED);
    expect(msg.translations).toBeUndefined();
    expect(msg.translationPending).toBe(false);
  });

  it('a history copy with a new body does not keep the old translation', async () => {
    const id = archiveIdAt(Date.now());
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: translatedMessage(id) }));

    // The same message from history, edited while this client was away and
    // not translated (yet): the old translation is not one of this text.
    store.dispatch(
      addRoomMessage({
        roomJID: ROOM,
        message: pendingMessage(id, { body: EDITED, translationPending: undefined }),
      })
    );
    expect(messageInStore(id).body).toBe(EDITED);
    expect(messageInStore(id).translations).toBeUndefined();

    // The same body again keeps what the message has.
    store.dispatch(addRoomMessage({ roomJID: ROOM, message: translatedMessage(id) }));
    store.dispatch(
      addRoomMessage({
        roomJID: ROOM,
        message: pendingMessage(id, { translationPending: undefined }),
      })
    );
    expect(messageInStore(id).translations['fr-CA'].translatedText).toBe(FRENCH);
  });
});

describe('useMessageTranslation: isPending', () => {
  let latest: MessageTranslationState;
  const Probe = ({ message }: { message: any }) => {
    latest = useMessageTranslation(message, READER, true);
    useRerenderAt(latest.pendingUntil);
    return null;
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is pending while the server translates, until the window closes', async () => {
    jest.useFakeTimers();
    const message = pendingMessage(archiveIdAt(Date.now()));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Probe message={message} />);
    });
    expect(latest.isPending).toBe(true);
    expect(latest.hasTranslation).toBe(false);

    // The update was missed: "Translating…" must not stay forever.
    await act(async () => {
      jest.advanceTimersByTime(TRANSLATION_PENDING_MAX_AGE_MS + 1000);
    });
    expect(latest.isPending).toBe(false);
    await act(async () => tree.unmount());
  });

  it('for an edit, counts from the edit, not from the message', async () => {
    jest.useFakeTimers();
    // Sent an hour ago, edited now.
    const message = pendingMessage(archiveIdAt(Date.now() - 60 * 60_000), {
      translationPendingSince: Date.now(),
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Probe message={message} />);
    });
    expect(latest.isPending).toBe(true);

    await act(async () => {
      jest.advanceTimersByTime(TRANSLATION_PENDING_MAX_AGE_MS + 1000);
    });
    expect(latest.isPending).toBe(false);
    await act(async () => tree.unmount());
  });

  it('is not pending once translated, for the reader’s own language, or without the mark', async () => {
    const id = archiveIdAt(Date.now());
    const cases = [
      pendingMessage(id, {
        translations: { 'fr-CA': { translatedText: FRENCH, language: 'fr-CA', languageName: 'French' } },
      }),
      pendingMessage(id, { langSource: 'fr' }),
      pendingMessage(id, { translationPending: undefined }),
      pendingMessage(archiveIdAt(Date.now() - TRANSLATION_PENDING_MAX_AGE_MS - 1000)),
    ];
    for (const message of cases) {
      let tree!: renderer.ReactTestRenderer;
      await act(async () => {
        tree = renderer.create(<Probe message={message} />);
      });
      expect(latest.isPending).toBe(false);
      await act(async () => tree.unmount());
    }
  });
});

describe('the bubble', () => {
  beforeEach(() => resetStore());

  const translatedVersion = (message: any) => ({
    ...message,
    translationPending: false,
    translations: {
      'fr-CA': { translatedText: FRENCH, language: 'fr-CA', languageName: 'Canadian French' },
    },
  });

  it('auto mode: the original with "Translating…", then the translation in its place', async () => {
    const message = pendingMessage(archiveIdAt(Date.now()));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <Message message={message} isUser={false} isReply={false} />
        </Provider>
      );
    });
    expect(textsOf(tree)).toContain(TEXT);
    expect(textsOf(tree)).toContain('Translating…');

    await act(async () => {
      tree.update(
        <Provider store={store}>
          <Message message={translatedVersion(message)} isUser={false} isReply={false} />
        </Provider>
      );
    });
    expect(textsOf(tree)).toContain(FRENCH);
    expect(textsOf(tree)).not.toContain('Translating…');
    await act(async () => tree.unmount());
  });

  it('auto mode: never on the reader’s own message', async () => {
    const message = pendingMessage(archiveIdAt(Date.now()));
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(
        <Provider store={store}>
          <Message message={message} isUser={true} isReply={false} />
        </Provider>
      );
    });
    expect(textsOf(tree)).not.toContain('Translating…');
    await act(async () => tree.unmount());
  });

  it('manual mode: the link is offered, a tap shows "Translating…", then the translation', async () => {
    const message = pendingMessage(archiveIdAt(Date.now()));
    const config = { translates: { enabled: true, mode: 'manual' } } as IConfig;
    const view = (msg: any) => (
      <Provider store={store}>
        <MessageTranslate message={msg} isUser={false} config={config} readerLocale={READER} />
      </Provider>
    );
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(view(message));
    });
    expect(textsOf(tree)).toContain('Translate');

    const link = tree.root
      .findAll((n) => typeof n.props?.onPress === 'function')
      .find((n) => n.findAllByType(Text).some((t) => t.props.children === 'Translate'))!;
    await act(async () => link.props.onPress());
    expect(textsOf(tree)).toContain('Translating…');

    await act(async () => tree.update(view(translatedVersion(message))));
    expect(textsOf(tree)).toContain(FRENCH);
    expect(textsOf(tree)).not.toContain('Translating…');

    // A failed translation takes the link away instead of leaving it dead.
    await act(async () =>
      tree.update(view({ ...message, translationPending: false }))
    );
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
  });
});
