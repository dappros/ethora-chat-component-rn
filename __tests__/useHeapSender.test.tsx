/**
 * The offline-send heap drains once the first wave of the join sweep settled
 * (priorityPresencesReady), joins each message's own room, and keeps a
 * message queued while its room cannot be joined.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';

let mockQueue: any[] = [];
jest.mock('../src/hooks/useMessageHeapState', () => ({
  useMessageHeapState: () => ({ queue: mockQueue }),
}));
jest.mock('react-redux', () => ({ useDispatch: () => jest.fn() }));

import { useHeapSender } from '../src/hooks/useHeapSender';

const msg = (id: string, roomJid: string) => ({
  id,
  roomJid,
  body: 'hi',
  user: { firstName: 'A', lastName: 'B', walletAddress: '0x1' },
});

const makeClient = (over: any = {}) => ({
  presencesReady: false,
  priorityPresencesReady: true,
  presenceInRoomStanza: jest.fn(async () => true),
  sendMessage: jest.fn(() => true),
  sendTextMessageWithTranslateTagStanza: jest.fn(),
  ...over,
});

const Probe = ({ client }: { client: any }) => {
  useHeapSender(client);
  return null;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mount = async (client: any) => {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Probe client={client} />);
  });
  return tree;
};

describe('useHeapSender join gating', () => {
  it('drains on the priority flag alone (the whole sweep need not be done)', async () => {
    mockQueue = [msg('1', 'a@conference.h')];
    const client = makeClient();
    await mount(client);
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(client.presenceInRoomStanza).toHaveBeenCalledWith('a@conference.h');
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('waits while the first wave has not settled, then drains by itself', async () => {
    mockQueue = [msg('1', 'a@conference.h')];
    const client = makeClient({ priorityPresencesReady: false });
    await mount(client);
    expect(client.sendMessage).not.toHaveBeenCalled();
    client.priorityPresencesReady = true;
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps a message queued while its room cannot be joined, sends the others', async () => {
    mockQueue = [msg('1', 'bad@conference.h'), msg('2', 'ok@conference.h')];
    const client = makeClient({
      presenceInRoomStanza: jest.fn(async (jid: string) => jid !== 'bad@conference.h'),
    });
    await mount(client);
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    const rooms = client.sendMessage.mock.calls.map((c: any[]) => c[0]);
    expect(rooms).toEqual(['ok@conference.h']);
  });
});
