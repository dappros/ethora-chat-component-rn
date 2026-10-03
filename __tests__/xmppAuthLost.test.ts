/**
 * The session ends only when the XMPP password is lost for good: rejected
 * by the server AND the refresh cannot produce a working one.
 */
jest.mock('@xmpp/client', () => {
  const { EventEmitter } = require('events');
  return {
    __esModule: true,
    default: () => {
      const c: any = new EventEmitter();
      c.start = jest.fn(() => new Promise(() => {}));
      c.stop = jest.fn(async () => {});
      c.send = jest.fn(async () => {});
      c.setMaxListeners = () => {};
      return c;
    },
    xml: jest.fn(),
  };
});
import XmppClient from '../src/networking/xmppClient';

const reject = (c: any) => {
  c.lastAuthError = 'not-authorized';
  c.authRejectionsSinceOnline += 1;
};

describe('XMPP auth lost', () => {
  it('fires after two refreshes that return no new password', async () => {
    const c: any = new XmppClient('u', 'old', { devServer: 'h' });
    const lost = jest.fn();
    c.setAuthLostHandler(lost);
    c.setCredentialsProvider(async () => ({ username: 'u', password: 'old' }));
    reject(c);
    await c.reconnect();
    expect(lost).not.toHaveBeenCalled();
    reject(c);
    await c.reconnect();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(c.suppressReconnect).toBe(true);
  });

  it('fires when the refresh request keeps failing after a rejection', async () => {
    const c: any = new XmppClient('u', 'old', { devServer: 'h' });
    const lost = jest.fn();
    c.setAuthLostHandler(lost);
    c.setCredentialsProvider(async () => {
      throw new Error('401');
    });
    reject(c);
    await c.reconnect();
    reject(c);
    await c.reconnect();
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire for a failed refresh without a rejection (offline)', async () => {
    const c: any = new XmppClient('u', 'old', { devServer: 'h' });
    const lost = jest.fn();
    c.setAuthLostHandler(lost);
    c.setCredentialsProvider(async () => {
      throw new Error('Network request failed');
    });
    c.credentialsRefreshedAt = 0;
    await c.reconnect();
    await c.reconnect();
    expect(lost).not.toHaveBeenCalled();
  });

  it('a working new password resets the count', async () => {
    const c: any = new XmppClient('u', 'old', { devServer: 'h' });
    const lost = jest.fn();
    c.setAuthLostHandler(lost);
    let n = 0;
    c.setCredentialsProvider(async () => ({ username: 'u', password: n++ === 0 ? 'old' : 'new' }));
    reject(c);
    await c.reconnect(); // no new password → 1 failure
    reject(c);
    await c.reconnect(); // new password → no failure
    expect(lost).not.toHaveBeenCalled();
  });
});
