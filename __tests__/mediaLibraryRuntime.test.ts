/**
 * expo-media-library's function API moved behind the `/legacy` subpath in
 * SDK 54. The root still exports the same names, but they throw on call —
 * which is exactly how the attach sheet's recents strip and "save to
 * gallery" silently broke. Pin the resolution order.
 */
describe('getMediaLibrary', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('prefers the /legacy subpath, where the function API actually works', () => {
    const legacy = { getAssetsAsync: jest.fn(), saveToLibraryAsync: jest.fn() };
    const root = { getAssetsAsync: jest.fn(() => { throw new Error('deprecated'); }) };
    jest.doMock('expo-media-library/legacy', () => legacy);
    jest.doMock('expo-media-library', () => root);

    const { getMediaLibrary } = require('../src/helpers/mediaLibraryRuntime');
    expect(getMediaLibrary()).toBe(legacy);
  });

  it('falls back to the root export on versions without the /legacy split', () => {
    const root = { getAssetsAsync: jest.fn() };
    jest.doMock('expo-media-library/legacy', () => {
      throw new Error('Cannot find module');
    });
    jest.doMock('expo-media-library', () => root);

    const { getMediaLibrary } = require('../src/helpers/mediaLibraryRuntime');
    expect(getMediaLibrary()).toBe(root);
  });

  it('returns null when the optional peer is not installed at all', () => {
    const missing = () => {
      throw new Error('Cannot find module');
    };
    jest.doMock('expo-media-library/legacy', missing);
    jest.doMock('expo-media-library', missing);

    const { getMediaLibrary } = require('../src/helpers/mediaLibraryRuntime');
    expect(getMediaLibrary()).toBeNull();
  });

  it('memoises the resolved module', () => {
    const legacy = { getAssetsAsync: jest.fn() };
    jest.doMock('expo-media-library/legacy', () => legacy);
    const { getMediaLibrary } = require('../src/helpers/mediaLibraryRuntime');
    expect(getMediaLibrary()).toBe(getMediaLibrary());
  });
});
