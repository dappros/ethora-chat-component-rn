/**
 * The minimized call strip lives under the visible SDK header. The most
 * recently mounted header hosts it; with none mounted, the overlay docks
 * it to the top of the screen (barHost === null).
 */
import {
  getCallUiState,
  registerCallBarHost,
  setCallMinimized,
} from '../src/components/VideoCalls/callUiStore';

describe('callUiStore', () => {
  it('hands the strip to the newest header and back when it unmounts', () => {
    let listId = 0;
    let chatId = 0;
    const unregisterList = registerCallBarHost((id) => (listId = id));
    const unregisterChat = registerCallBarHost((id) => (chatId = id));
    expect(getCallUiState().barHost).toBe(chatId);

    unregisterChat();
    expect(getCallUiState().barHost).toBe(listId);

    unregisterList();
    expect(getCallUiState().barHost).toBeNull();
  });

  it('tracks minimized', () => {
    setCallMinimized(true);
    expect(getCallUiState().minimized).toBe(true);
    setCallMinimized(false);
    expect(getCallUiState().minimized).toBe(false);
  });
});
