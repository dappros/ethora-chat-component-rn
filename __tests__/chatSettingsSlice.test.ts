/**
 * chatSettingsSlice — reducer-level L1 tests.
 *
 * Parity with roomsSliceReducer.test.ts: call the reducer directly with
 * `(previousState, action)`, no store/middleware/thunks. Pins the
 * contract for every action exported from `chatSettingsSlice`.
 *
 * AsyncStorage is stubbed via jest.setup.js — `asyncLocalStorage` calls
 * inside the reducer fire-and-forget into that mock without blocking
 * the synchronous reducer return.
 */

import chatReducer, {
  setUser,
  updateUser,
  setConfig,
  setActiveModal,
  setActiveFile,
  setDeleteModal,
  setStoreClient,
  setSelectedUser,
  refreshTokens,
  logout,
  setLangSource,
} from '../src/roomStore/chatSettingsSlice';
import type { IConfig, ModalFile, User } from '../src/types/types';
import type { Iso639_1Codes } from '../src/types/models/language.model';

const initial = () => chatReducer(undefined, { type: '@@INIT' });

// Minimal User payload — every defaulted field gets normalised through
// `unpackAndTransform` so this only needs to set the bits we care about.
const sampleUser = (overrides: Partial<User> = {}): User =>
  ({
    _id: 'u1',
    firstName: 'Alice',
    lastName: 'Anderson',
    email: 'alice@example.com',
    token: 'tok-1',
    refreshToken: 'rtok-1',
    xmppPassword: 'xpw',
    xmppUsername: '0xabc',
    defaultWallet: { walletAddress: '0xabc' },
    ...overrides,
  } as User);

describe('chatSettingsSlice — initial state', () => {
  it('boots with a blank user, default config, and closed delete modal', () => {
    const s = initial();
    expect(s.user._id).toBe('');
    expect(s.user.token).toBe('');
    expect(s.user.isProfileOpen).toBe(true); // baked-in default
    expect(s.config?.colors?.primary).toBe('#0052CD');
    expect(s.config?.colors?.secondary).toBe('#F3F6FC');
    expect(s.deleteModal).toEqual({
      isDeleteModal: false,
      roomJid: '',
      messageId: '',
    });
    expect(s.activeModal).toBeUndefined();
    expect(s.selectedUser).toBeUndefined();
    expect(s.client).toBeUndefined();
    expect(s.langSource).toBeUndefined();
  });
});

describe('chatSettingsSlice — setUser / updateUser', () => {
  it('setUser normalises the payload through unpackAndTransform', () => {
    const next = chatReducer(
      initial(),
      setUser(sampleUser({ profileImage: 'http://img.test/a.png' }))
    );
    expect(next.user._id).toBe('u1');
    expect(next.user.email).toBe('alice@example.com');
    expect(next.user.profileImage).toBe('http://img.test/a.png');
    // unpackAndTransform pulls walletAddress out of defaultWallet
    expect(next.user.walletAddress).toBe('0xabc');
    // …and resets the modal-open flags (caller intent: fresh login)
    expect(next.user.isProfileOpen).toBe(false);
    expect(next.user.isAssetsOpen).toBe(false);
  });

  it('setUser tolerates missing optional fields', () => {
    const next = chatReducer(initial(), setUser({} as User));
    expect(next.user._id).toBe('');
    expect(next.user.email).toBe('');
    expect(next.user.roles).toEqual([]);
    expect(next.user.tags).toEqual([]);
    expect(next.user.__v).toBe(0);
  });

  it('updateUser merges into the current user without replacing it', () => {
    const seeded = chatReducer(initial(), setUser(sampleUser()));
    const next = chatReducer(
      seeded,
      updateUser({ updates: { firstName: 'Alicia', lastName: 'Smith' } })
    );
    expect(next.user.firstName).toBe('Alicia');
    expect(next.user.lastName).toBe('Smith');
    expect(next.user._id).toBe('u1'); // preserved
    expect(next.user.email).toBe('alice@example.com'); // preserved
  });

  it('updateUser with empty updates is a no-op on shape', () => {
    const seeded = chatReducer(initial(), setUser(sampleUser()));
    const next = chatReducer(seeded, updateUser({ updates: {} }));
    expect(next.user._id).toBe('u1');
    expect(next.user.firstName).toBe('Alice');
  });

  it('refreshTokens stamps both tokens onto the existing user', () => {
    const seeded = chatReducer(initial(), setUser(sampleUser()));
    const next = chatReducer(
      seeded,
      refreshTokens({ token: 'tok-2', refreshToken: 'rtok-2' })
    );
    expect(next.user.token).toBe('tok-2');
    expect(next.user.refreshToken).toBe('rtok-2');
    expect(next.user._id).toBe('u1');
    expect(next.user.email).toBe('alice@example.com');
  });
});

describe('chatSettingsSlice — config / langSource / client', () => {
  it('setConfig replaces the whole config object', () => {
    const custom: IConfig = {
      colors: { primary: '#ff00aa', secondary: '#00ffaa' },
    } as IConfig;
    const next = chatReducer(initial(), setConfig(custom));
    expect(next.config?.colors?.primary).toBe('#ff00aa');
    expect(next.config?.colors?.secondary).toBe('#00ffaa');
  });

  it('setConfig(undefined) clears the config', () => {
    const seeded = chatReducer(
      initial(),
      setConfig({ colors: { primary: '#fff', secondary: '#000' } } as IConfig)
    );
    const next = chatReducer(seeded, setConfig(undefined));
    expect(next.config).toBeUndefined();
  });

  it('setLangSource sets and clears the language code', () => {
    const set = chatReducer(initial(), setLangSource('en' as Iso639_1Codes));
    expect(set.langSource).toBe('en');
    const cleared = chatReducer(set, setLangSource(undefined));
    expect(cleared.langSource).toBeUndefined();
  });

  it('setStoreClient stashes the (opaque) client reference', () => {
    const client = { kind: 'fake-xmpp-client' };
    const next = chatReducer(initial(), setStoreClient(client));
    expect(next.client).toBe(client);
  });
});

describe('chatSettingsSlice — modal + selected-user', () => {
  it('setActiveModal toggles the active modal id', () => {
    const opened = chatReducer(initial(), setActiveModal('media' as any));
    expect(opened.activeModal).toBe('media');
    const closed = chatReducer(opened, setActiveModal(undefined));
    expect(closed.activeModal).toBeUndefined();
  });

  it('setDeleteModal opens, then closes back to undefined', () => {
    const opened = chatReducer(
      initial(),
      setDeleteModal({
        isDeleteModal: true,
        roomJid: 'r1@conf',
        messageId: 'm1',
      })
    );
    expect(opened.deleteModal).toEqual({
      isDeleteModal: true,
      roomJid: 'r1@conf',
      messageId: 'm1',
    });
    const closed = chatReducer(opened, setDeleteModal(undefined));
    expect(closed.deleteModal).toBeUndefined();
  });

  it('setActiveFile stores the file metadata', () => {
    const file: ModalFile = {
      url: 'https://files.test/a.png',
      mimeType: 'image/png',
      name: 'a.png',
    } as ModalFile;
    const next = chatReducer(initial(), setActiveFile(file));
    expect(next.activeFile).toEqual(file);
  });

  it('setSelectedUser sets and clears', () => {
    const next = chatReducer(
      initial(),
      setSelectedUser({ _id: 'u2', firstName: 'Bob' } as any)
    );
    expect(next.selectedUser?._id).toBe('u2');
    const cleared = chatReducer(next, setSelectedUser(undefined));
    expect(cleared.selectedUser).toBeUndefined();
  });
});

describe('chatSettingsSlice — logout', () => {
  it('logout wipes user, config, client, and langSource back to defaults', () => {
    let s = initial();
    s = chatReducer(s, setUser(sampleUser()));
    s = chatReducer(
      s,
      setConfig({ colors: { primary: '#fff', secondary: '#000' } } as IConfig)
    );
    s = chatReducer(s, setStoreClient({ k: 'v' }));
    s = chatReducer(s, setLangSource('en' as Iso639_1Codes));

    const next = chatReducer(s, logout());
    expect(next.user._id).toBe('');
    expect(next.user.token).toBe('');
    expect(next.user.email).toBe('');
    expect(next.config).toBeUndefined();
    expect(next.client).toBeUndefined();
    expect(next.langSource).toBeUndefined();
  });
});
