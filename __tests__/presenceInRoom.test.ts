import { presenceInRoom } from '../src/networking/xmpp/presenceInRoom.xmpp';

// Regression: presenceInRoom's timeout timer used to keep running after a
// successful join, so it could fire later, call unsubscribe again and
// construct a stray rejection well after the caller already had its answer.
const makeClient = () => {
  const handlers: Array<(stanza: any) => void> = [];
  return {
    jid: {
      toString: () => 'me@example.com/res',
      getLocal: () => 'me',
    },
    on: jest.fn((event: string, handler: any) => {
      if (event === 'stanza') {handlers.push(handler);}
    }),
    off: jest.fn((event: string, handler: any) => {
      const idx = handlers.indexOf(handler);
      if (idx >= 0) {handlers.splice(idx, 1);}
    }),
    send: jest.fn(() => Promise.resolve()),
    emitStanza: (stanza: any) => {
      handlers.slice().forEach((h) => h(stanza));
    },
  } as any;
};

const fakePresenceResult = (id: string, from: string, type?: string) => ({
  is: (tag: string) => tag === 'presence',
  attrs: { id, from, type },
  getChild: () => undefined,
});

const ROOM = 'room1@conference.example.com';

describe('presenceInRoom', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves once the join presence stanza comes back', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const joinPromise = presenceInRoom(client, ROOM, 0, 2000);
    await Promise.resolve();
    await Promise.resolve();
    const sent = client.send.mock.calls[0][0];
    client.emitStanza(fakePresenceResult(sent.attrs.id, `${ROOM}/me`));
    await jest.advanceTimersByTimeAsync(0);
    await expect(joinPromise).resolves.toBeDefined();
  });

  it('does not wait an artificial 2 s after the answer (settle delay defaults to 0)', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    let resolved = false;
    const joinPromise = presenceInRoom(client, ROOM).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    const sent = client.send.mock.calls[0][0];
    client.emitStanza(fakePresenceResult(sent.attrs.id, `${ROOM}/me`));
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(true);
    await joinPromise;
  });

  it('still honours an explicit settle delay', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    let resolved = false;
    presenceInRoom(client, ROOM, 500, 2000).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    const sent = client.send.mock.calls[0][0];
    client.emitStanza(fakePresenceResult(sent.attrs.id, `${ROOM}/me`));
    await jest.advanceTimersByTimeAsync(400);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(true);
  });

  it('does not let the timeout fire after a successful join', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const joinPromise = presenceInRoom(client, ROOM, 0, 2000);
    await Promise.resolve();
    await Promise.resolve();
    const sent = client.send.mock.calls[0][0];
    client.emitStanza(fakePresenceResult(sent.attrs.id, `${ROOM}/me`));
    await jest.advanceTimersByTimeAsync(0);
    await joinPromise;

    const offCallsBeforeTimeout = client.off.mock.calls.length;
    await jest.advanceTimersByTimeAsync(5000);
    // unsubscribe() must not have been invoked again by a stray timer.
    expect(client.off.mock.calls.length).toBe(offCallsBeforeTimeout);
  });

  it('still rejects with a timeout error if no presence reply arrives', async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const joinPromise = presenceInRoom(client, ROOM, 0, 2000);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.all([
      expect(joinPromise).rejects.toThrow(`presence_timeout:${ROOM}`),
      jest.advanceTimersByTimeAsync(2000),
    ]);
  });

  it('rejects with presence_error:<code> on an error presence', async () => {
    const client = makeClient();
    const joinPromise = presenceInRoom(client, ROOM, 0, 2000);
    await Promise.resolve();
    await Promise.resolve();
    const sent = client.send.mock.calls[0][0];
    const stanza: any = fakePresenceResult(sent.attrs.id, `${ROOM}/me`, 'error');
    stanza.getChild = (name: string) =>
      name === 'error'
        ? { getChild: (c: string) => (c === 'forbidden' ? {} : undefined), attrs: {} }
        : undefined;
    client.emitStanza(stanza);
    await expect(joinPromise).rejects.toThrow(`presence_error:forbidden:${ROOM}`);
  });

  it('rejects an invalid jid without sending anything', async () => {
    const client = makeClient();
    await expect(presenceInRoom(client, 'no-at-sign')).rejects.toThrow(
      'presence_invalid_jid'
    );
    expect(client.send).not.toHaveBeenCalled();
  });
});

describe('presenceInRoom join history', () => {
  const sentX = async (historyArg?: number) => {
    const client = makeClient();
    // delay 0 / short timeout: we only inspect the stanza that was sent.
    const p =
      historyArg === undefined
        ? presenceInRoom(client, ROOM, 0, 50)
        : presenceInRoom(client, ROOM, 0, 50, historyArg);
    p.catch(() => {});
    await Promise.resolve();
    await Promise.resolve();
    const presence = client.send.mock.calls[0][0];
    return presence.getChild('x', 'http://jabber.org/protocol/muc');
  };

  it('asks the MUC service to replay no history by default', async () => {
    const x = await sentX();
    expect(x).toBeDefined();
    expect(x.getChild('history')?.attrs.maxstanzas).toBe('0');
  });

  it('honours an explicit joinHistoryStanzas value', async () => {
    const x = await sentX(20);
    expect(x.getChild('history')?.attrs.maxstanzas).toBe('20');
  });

  it('treats a negative or non-finite value as 0', async () => {
    expect((await sentX(-3)).getChild('history')?.attrs.maxstanzas).toBe('0');
    expect((await sentX(NaN)).getChild('history')?.attrs.maxstanzas).toBe('0');
  });
});
