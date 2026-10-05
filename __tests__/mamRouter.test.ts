/**
 * The MAM router must not settle a history page before every result of
 * that page has been parsed: a server can deliver all results and the
 * closing iq in one socket frame, so they are emitted in one tick while
 * the (async) parsing of each result finishes microtasks later.
 */
import {
  __resetMamRouter,
  beginMamQuery,
  cancelMamQuery,
  claimMamResult,
  collectMamMessage,
  routeMamIq,
} from '../src/networking/xmpp/mamRouter';

jest.mock('../src/roomStore', () => ({
  store: { dispatch: jest.fn() },
}));
import { store } from '../src/roomStore';

const result = (queryid: string) => ({
  getChild: (n: string) => (n === 'result' ? { attrs: { queryid } } : undefined),
});
const iq = (id: string, type = 'result') => ({
  is: (n: string) => n === 'iq',
  attrs: { id, type },
});

beforeEach(() => {
  __resetMamRouter();
  (store.dispatch as jest.Mock).mockClear();
});

describe('mamRouter', () => {
  it('waits for claimed results that are still parsing when the iq lands first', async () => {
    const page = beginMamQuery('q1', 'r@h');
    // Three results + the fin, all in one tick:
    expect(claimMamResult(result('q1'))).toBe(true);
    expect(claimMamResult(result('q1'))).toBe(true);
    expect(claimMamResult(result('q1'))).toBe(true);
    expect(routeMamIq(iq('q1'))).toBe(true);

    let settled = false;
    page.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    // Parses finish later; one of them yields nothing.
    collectMamMessage(result('q1'), { id: '1' } as any);
    collectMamMessage(result('q1'), undefined);
    collectMamMessage(result('q1'), { id: '2' } as any);

    const messages = await page;
    expect(messages.map((m) => m.id)).toEqual(['1', '2']);
    // Applied once, as a page.
    expect(store.dispatch).toHaveBeenCalledTimes(1);
    expect((store.dispatch as jest.Mock).mock.calls[0][0].payload).toEqual({
      roomJID: 'r@h',
      messages: [{ id: '1' }, { id: '2' }],
    });
  });

  it('settles at once when nothing is outstanding', async () => {
    const page = beginMamQuery('q2', 'r@h');
    claimMamResult(result('q2'));
    collectMamMessage(result('q2'), { id: '9' } as any);
    routeMamIq(iq('q2'));
    await expect(page).resolves.toEqual([{ id: '9' }]);
  });

  it('does not apply a self-applied page, but still returns it', async () => {
    const page = beginMamQuery('q3', 'r@h', false);
    claimMamResult(result('q3'));
    collectMamMessage(result('q3'), { id: '5' } as any);
    routeMamIq(iq('q3'));
    await expect(page).resolves.toEqual([{ id: '5' }]);
    expect(store.dispatch).not.toHaveBeenCalled();
  });

  it('rejects on an iq error and hands back what arrived on cancel', async () => {
    const page = beginMamQuery('q4', 'r@h');
    routeMamIq(iq('q4', 'error'));
    await expect(page).rejects.toThrow('mam query error');

    const page2 = beginMamQuery('q5', 'r@h');
    claimMamResult(result('q5'));
    collectMamMessage(result('q5'), { id: '7' } as any);
    expect(cancelMamQuery('q5')).toEqual([{ id: '7' }]);
    await expect(page2).resolves.toEqual([{ id: '7' }]);
  });

  it('ignores results and iqs that belong to no pending query', () => {
    expect(claimMamResult(result('nope'))).toBe(false);
    expect(collectMamMessage(result('nope'), { id: 'x' } as any)).toBe(false);
    expect(routeMamIq(iq('nope'))).toBe(false);
  });
});
