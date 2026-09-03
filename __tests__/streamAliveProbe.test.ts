/**
 * Liveness-probe tuning.
 *
 * The probe catches a ZOMBIE socket (reads `online`, carries nothing).
 * It used to fire after EVERY send with a 4s budget and tear the
 * connection down on a single missed round trip — which on a slow link
 * repeatedly killed healthy streams, and whose reconnect replayed the
 * outbound queue and duplicated already-delivered messages (#31).
 *
 * These pin the tuned contract: throttled, config-gated on the send path,
 * and a teardown requires a CONFIRMED second failure.
 */
import XmppClient from '../src/networking/xmppClient';

jest.useFakeTimers();

const makeClient = (settings: any = {}) => {
  const c: any = Object.create(XmppClient.prototype);
  c.status = 'online';
  c.suppressReconnect = false;
  c.client = {};
  c.lastStreamProbeAt = 0;
  c.failedProbeStreak = 0;
  c.streamProbeTimeoutMs = 10_000;
  c.minStreamProbeIntervalMs = 15_000;
  c.streamProbeConfirmDelayMs = 2_000;
  c.streamProbeFailuresForReconnect = 2;
  c.pingOnSendEnabled = settings.xmppPingOnSendEnabled !== false;
  c.forceReconnect = jest.fn();
  return c;
};

describe('ensureStreamAlive — confirmation before teardown', () => {
  it('does NOT reconnect on a single missed probe', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(false);

    await c.ensureStreamAlive({ force: true });

    expect(c.forceReconnect).not.toHaveBeenCalled();
    expect(c.failedProbeStreak).toBe(1);
  });

  it('reconnects only once a second probe also fails', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(false);

    await c.ensureStreamAlive({ force: true });
    expect(c.forceReconnect).not.toHaveBeenCalled();

    await c.ensureStreamAlive({ force: true });
    expect(c.forceReconnect).toHaveBeenCalledTimes(1);
  });

  it('a healthy probe clears the failure streak', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(false);
    await c.ensureStreamAlive({ force: true });
    expect(c.failedProbeStreak).toBe(1);

    c.verifyStreamAlive = jest.fn().mockResolvedValue(true);
    await c.ensureStreamAlive({ force: true });

    expect(c.failedProbeStreak).toBe(0);
    expect(c.forceReconnect).not.toHaveBeenCalled();
  });

  it('never reconnects while the stream reports healthy', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(true);
    await c.ensureStreamAlive({ force: true });
    await c.ensureStreamAlive({ force: true });
    expect(c.forceReconnect).not.toHaveBeenCalled();
  });
});

describe('ensureStreamAlive — throttling', () => {
  it('skips a probe that lands inside the throttle window', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(true);

    await c.ensureStreamAlive();          // probes
    await c.ensureStreamAlive();          // throttled
    await c.ensureStreamAlive();          // throttled

    expect(c.verifyStreamAlive).toHaveBeenCalledTimes(1);
  });

  it('force bypasses the throttle (watchdog / NetInfo)', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(true);

    await c.ensureStreamAlive();
    await c.ensureStreamAlive({ force: true });

    expect(c.verifyStreamAlive).toHaveBeenCalledTimes(2);
  });

  it('does nothing when offline or suppressed', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(false);

    c.status = 'offline';
    await c.ensureStreamAlive({ force: true });
    c.status = 'online';
    c.suppressReconnect = true;
    await c.ensureStreamAlive({ force: true });

    expect(c.verifyStreamAlive).not.toHaveBeenCalled();
    expect(c.forceReconnect).not.toHaveBeenCalled();
  });
});

describe('send-path probe honours xmppPingOnSendEnabled', () => {
  it('probes on send by default', () => {
    const c = makeClient();
    c.ensureStreamAlive = jest.fn().mockResolvedValue(undefined);
    c.ensureStreamAliveAfterSend();
    expect(c.ensureStreamAlive).toHaveBeenCalledWith({ reason: 'send' });
  });

  it('skips the send probe when the host disables it', () => {
    const c = makeClient({ xmppPingOnSendEnabled: false });
    c.ensureStreamAlive = jest.fn().mockResolvedValue(undefined);
    c.ensureStreamAliveAfterSend();
    expect(c.ensureStreamAlive).not.toHaveBeenCalled();
  });

  it('send-path probe is NOT forced, so it stays throttled', async () => {
    const c = makeClient();
    c.verifyStreamAlive = jest.fn().mockResolvedValue(true);
    c.ensureStreamAliveAfterSend();
    c.ensureStreamAliveAfterSend();
    c.ensureStreamAliveAfterSend();
    await Promise.resolve();
    expect(c.verifyStreamAlive).toHaveBeenCalledTimes(1);
  });
});
