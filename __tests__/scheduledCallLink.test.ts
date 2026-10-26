/**
 * parseScheduledCallLink: which URLs are a scheduled-call link, and the slug
 * inside. The slug is the secret, so everything that is not exactly the
 * contract's two shapes must come back null.
 */

import {
  __resetScheduledCallLinksForTests,
  configureScheduledCallLinks,
  getScheduledCallLinkTargets,
  parseScheduledCallLink,
} from '../src/booking/scheduledCallLink';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';

const SLUG = 'Zq8x_LmN3pRtV-w2YkA9bc'; // 22 url-safe chars

beforeEach(() => {
  __resetScheduledCallLinksForTests();
  store.dispatch(setConfig({ baseUrl: 'https://api.test' } as any));
});

describe('https links', () => {
  it('accepts the hosted web app by default', () => {
    expect(parseScheduledCallLink(`https://app.chat.ethora.com/call/${SLUG}`)).toBe(SLUG);
  });

  it('ignores case in the host, a trailing slash, a query and a fragment', () => {
    expect(
      parseScheduledCallLink(`https://APP.chat.ethora.com/call/${SLUG}/?utm=1#x`)
    ).toBe(SLUG);
  });

  it('rejects hosts that are not configured', () => {
    expect(parseScheduledCallLink(`https://evil.example.com/call/${SLUG}`)).toBeNull();
    expect(
      parseScheduledCallLink(`https://app.chat.ethora.com.evil.com/call/${SLUG}`)
    ).toBeNull();
    expect(
      parseScheduledCallLink(`https://app.chat.ethora.com@evil.com/call/${SLUG}`)
    ).toBeNull();
  });

  it('accepts a host given through configureScheduledCallLinks', () => {
    configureScheduledCallLinks({ hosts: ['https://chat.acme.io/'] });
    expect(parseScheduledCallLink(`https://chat.acme.io/call/${SLUG}`)).toBe(SLUG);
  });

  it('accepts a host given through config.scheduledCalls', () => {
    store.dispatch(
      setConfig({ scheduledCalls: { hosts: ['calls.acme.io'] } } as any)
    );
    expect(parseScheduledCallLink(`https://calls.acme.io/call/${SLUG}`)).toBe(SLUG);
    expect(getScheduledCallLinkTargets().hosts).toContain('app.chat.ethora.com');
  });

  it('never trusts plain http', () => {
    expect(parseScheduledCallLink(`http://app.chat.ethora.com/call/${SLUG}`)).toBeNull();
  });

  it('wants /call/<slug> exactly', () => {
    expect(parseScheduledCallLink('https://app.chat.ethora.com/call/')).toBeNull();
    expect(parseScheduledCallLink(`https://app.chat.ethora.com/calls/${SLUG}`)).toBeNull();
    expect(parseScheduledCallLink(`https://app.chat.ethora.com/call/${SLUG}/extra`)).toBeNull();
    expect(parseScheduledCallLink(`https://app.chat.ethora.com/x/call/${SLUG}`)).toBeNull();
    expect(parseScheduledCallLink('https://app.chat.ethora.com/call/short')).toBeNull();
    expect(parseScheduledCallLink('https://app.chat.ethora.com/call/has%20space%20in%20it%20x')).toBeNull();
  });
});

describe('custom scheme links', () => {
  it('accepts <scheme>://call/<slug>', () => {
    expect(parseScheduledCallLink(`ethoraappreactnative://call/${SLUG}`)).toBe(SLUG);
  });

  it('accepts the three-slash form some launchers hand over', () => {
    expect(parseScheduledCallLink(`ethoraappreactnative:///call/${SLUG}`)).toBe(SLUG);
  });

  it('with schemes configured accepts only those', () => {
    configureScheduledCallLinks({ schemes: ['ethorachat'] });
    expect(parseScheduledCallLink(`ethorachat://call/${SLUG}`)).toBe(SLUG);
    expect(parseScheduledCallLink(`other://call/${SLUG}`)).toBeNull();
  });

  it('reads schemes from config.scheduledCalls too', () => {
    store.dispatch(setConfig({ scheduledCalls: { schemes: ['myapp'] } } as any));
    expect(parseScheduledCallLink(`myapp://call/${SLUG}`)).toBe(SLUG);
    expect(parseScheduledCallLink(`ethoraappreactnative://call/${SLUG}`)).toBeNull();
  });

  it('wants the call host, not another one', () => {
    expect(parseScheduledCallLink(`ethoraappreactnative://room/${SLUG}`)).toBeNull();
    expect(parseScheduledCallLink(`ethoraappreactnative://call/${SLUG}/more`)).toBeNull();
  });

  it('refuses script-like schemes', () => {
    expect(parseScheduledCallLink(`javascript://call/${SLUG}`)).toBeNull();
    expect(parseScheduledCallLink(`file://call/${SLUG}`)).toBeNull();
  });
});

describe('garbage', () => {
  it.each([undefined, null, '', '   ', 'not a url', 42 as any, '/call/' + SLUG])(
    'returns null for %p',
    (value) => {
      expect(parseScheduledCallLink(value as any)).toBeNull();
    }
  );
});
