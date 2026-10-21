/**
 * The report form sends what POST /v1/chats/reports/:chatName accepts: the
 * bare room name, a server category value and a non-empty text.
 */
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setUser } from '../src/roomStore/chatSettingsSlice';
import { ToastProvider } from '../src/context/ToastContext';
import ReportChatModal from '../src/components/Modals/ChatProfileModal/ReportChatModal';

const mockPostReportRoom = jest.fn();
jest.mock('../src/networking/api-requests/rooms.api', () => ({
  ...jest.requireActual('../src/networking/api-requests/rooms.api'),
  postReportRoom: (...args: unknown[]) => mockPostReportRoom(...args),
}));

const ROOM = 'app1_9b2f6c1e@conference.xmpp.chat.ethora.com';

const render = async (onClose = jest.fn()) => {
  await act(async () => {
    store.dispatch(setUser({ firstName: 'Ann', token: 'jwt' } as any));
  });
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ToastProvider>
          <ReportChatModal visible roomJid={ROOM} onClose={onClose} />
        </ToastProvider>
      </Provider>
    );
  });
  const byId = (testID: string) =>
    tree.root.find((n) => n.props?.testID === testID && n.props.onPress);
  const press = async (testID: string) => {
    await act(async () => {
      byId(testID).props.onPress();
    });
  };
  return { tree, press, onClose };
};

beforeEach(() => {
  mockPostReportRoom.mockReset();
  mockPostReportRoom.mockResolvedValue({});
});

describe('ReportChatModal', () => {
  it.each([
    ['violence', 'violance', 'Violence'],
    ['personalDetails', 'personal details', 'Personal Details'],
    ['illegalDrugs', 'illegal drugs', 'Illegal Drugs'],
    ['childAbuse', 'other', 'Child Abuse'],
  ])('sends %s as the server category %s', async (id, category, text) => {
    const { press, onClose } = await render();
    await press(`report-category-${id}`);
    await press('report-submit');
    expect(mockPostReportRoom).toHaveBeenCalledWith({
      chatName: 'app1_9b2f6c1e',
      category,
      text,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('sends the typed details for Other', async () => {
    const { tree, press } = await render();
    await press('report-category-other');
    await act(async () => {
      tree.root
        .find((n) => n.props?.testID === 'report-details' && n.props.onChangeText)
        .props.onChangeText('  impersonates support ');
    });
    await press('report-submit');
    expect(mockPostReportRoom).toHaveBeenCalledWith({
      chatName: 'app1_9b2f6c1e',
      category: 'other',
      text: 'impersonates support',
    });
  });

  it('stays open when the server refuses', async () => {
    mockPostReportRoom.mockRejectedValueOnce(new Error('Error reporting chat'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { press, onClose } = await render();
    await press('report-category-spam');
    await press('report-submit');
    expect(mockPostReportRoom).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
