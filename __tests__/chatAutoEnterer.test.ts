/**
 * chatAutoEnterer — single-room auto-enter helper.
 *
 * Drives the "consumer wants to land on a specific room on launch"
 * path. Three branches: bare chat id (combined with conference
 * domain), full JID (passed through), and missing roomJID (no-op).
 */

import { chatAutoEnterer } from '../src/helpers/chatAutoEnterer';
import { setCurrentRoom } from '../src/roomStore/roomsSlice';

describe('chatAutoEnterer', () => {
  it('combines a bare chat id with config.xmppSettings.conference', () => {
    const dispatch = jest.fn();
    chatAutoEnterer({
      roomJID: 'r1',
      wasAutoSelected: false,
      config: { xmppSettings: { conference: 'conf.host' } } as any,
      dispatch: dispatch as any,
    });
    expect(dispatch).toHaveBeenCalledWith(
      setCurrentRoom({ roomJID: 'r1@conf.host' })
    );
  });

  it('passes a full JID through unchanged', () => {
    const dispatch = jest.fn();
    chatAutoEnterer({
      roomJID: 'r1@somewhere',
      wasAutoSelected: false,
      config: { xmppSettings: { conference: 'conf.host' } } as any,
      dispatch: dispatch as any,
    });
    expect(dispatch).toHaveBeenCalledWith(
      setCurrentRoom({ roomJID: 'r1@somewhere' })
    );
  });

  it('uses a bare chat id verbatim when no conference is configured', () => {
    const dispatch = jest.fn();
    chatAutoEnterer({
      roomJID: 'r1',
      wasAutoSelected: false,
      config: {} as any,
      dispatch: dispatch as any,
    });
    expect(dispatch).toHaveBeenCalledWith(setCurrentRoom({ roomJID: 'r1' }));
  });

  it('does not dispatch when roomJID is missing', () => {
    const dispatch = jest.fn();
    chatAutoEnterer({
      roomJID: undefined,
      wasAutoSelected: false,
      config: { xmppSettings: { conference: 'conf.host' } } as any,
      dispatch: dispatch as any,
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
