jest.mock('../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp', () => ({
  getChatsPrivateStoreRequest: jest.fn(),
}));

jest.mock('../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp', () => ({
  setChatsPrivateStoreRequest: jest.fn(),
}));

import { flushLastViewedToPrivateStore } from '../src/networking/xmpp/flushLastViewedToPrivateStore';
import { getChatsPrivateStoreRequest } from '../src/networking/xmpp/getChatsPrivateStoreRequest.xmpp';
import { setChatsPrivateStoreRequest } from '../src/networking/xmpp/setChatsPrivateStoreRequest.xmpp';

describe('flushLastViewedToPrivateStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('writes Date.now() for the visible room instead of relying on a sentinel 0 marker', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    (getChatsPrivateStoreRequest as jest.Mock).mockResolvedValue({ existing: '100' });
    (setChatsPrivateStoreRequest as jest.Mock).mockResolvedValue(true);

    const ok = await flushLastViewedToPrivateStore(
      { client: { send: jest.fn() } },
      {
        'room@conf': {
          jid: 'room@conf',
          lastViewedTimestamp: 0,
          unreadMessages: 0,
        },
      },
      { visibleRoomJID: 'room@conf' }
    );

    expect(ok).toBe(true);
    expect(setChatsPrivateStoreRequest).toHaveBeenCalledWith(
      { send: expect.any(Function) },
      JSON.stringify({
        existing: '100',
        'room@conf': '1700000000000',
      })
    );
    (Date.now as jest.MockedFunction<typeof Date.now>).mockRestore();
  });
});
