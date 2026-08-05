/**
 * `config.translates.readerLocale` is how a host drives the reader's
 * language from outside the component. Nothing was syncing it into
 * `langSource`, so pinning it only redirected the incoming-translation
 * lookup — the UI captions and the `<translate source>` stamped on outgoing
 * messages both kept following the unset `langSource`. Picking a language
 * in the testbed's Setup tab therefore appeared to do nothing.
 *
 * The legacy seed alongside it had its condition inverted, which fired
 * `setLangSource(undefined)` on every XMPP init merely because translation
 * was enabled — wiping whatever the reader had chosen from the globe.
 */

import {
  resolveExternalReaderLocaleLangSource,
  resolveLegacyTranslatesLangSource,
} from '../src/helpers/resolveLangSource';
import { IConfig } from '../src/types/types';

describe('resolveExternalReaderLocaleLangSource', () => {
  it('resolves a host-pinned reader locale', () => {
    expect(resolveExternalReaderLocaleLangSource('es-US')).toBe('es-US');
  });

  it('keeps the region rather than collapsing to the base language', () => {
    // RN's LANGUAGE_OPTIONS are region-tagged and the in-chat picker stores
    // that full form; dropping the region here would make the external and
    // in-app paths disagree about what langSource holds.
    expect(resolveExternalReaderLocaleLangSource('fr-CA')).toBe('fr-CA');
  });

  it('resolves to undefined when the host set nothing', () => {
    // Absence must never clobber the reader's own pick.
    expect(resolveExternalReaderLocaleLangSource(undefined)).toBeUndefined();
    expect(resolveExternalReaderLocaleLangSource('')).toBeUndefined();
  });
});

describe('resolveLegacyTranslatesLangSource', () => {
  it('seeds only when the host actually set a legacy locale', () => {
    const config = {
      enabled: true,
      translations: 'pt',
    } as unknown as IConfig['translates'];
    expect(resolveLegacyTranslatesLangSource(config)).toBe('pt');
  });

  it('does NOT fire just because translation is enabled', () => {
    // The regression: this used to dispatch setLangSource(undefined) on
    // every XMPP init, resetting the reader's language on every reconnect.
    const config = { enabled: true } as unknown as IConfig['translates'];
    expect(resolveLegacyTranslatesLangSource(config)).toBeUndefined();
  });

  it('does nothing when translation is off', () => {
    const config = {
      enabled: false,
      translations: 'pt',
    } as unknown as IConfig['translates'];
    expect(resolveLegacyTranslatesLangSource(config)).toBeUndefined();
    expect(resolveLegacyTranslatesLangSource(undefined)).toBeUndefined();
  });
});
