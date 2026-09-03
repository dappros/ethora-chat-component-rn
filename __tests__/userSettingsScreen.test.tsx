import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { setConfig } from '../src/roomStore/chatSettingsSlice';
import UserSettingsModal from '../src/components/Modals/UserSettingsModal/UserSettingsModal';
import { MODAL_TYPES } from '../src/helpers/constants/MODAL_TYPES';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
  SafeAreaProvider: ({ children }: any) => children,
}));

const render = async () => {
  await act(async () => {
    store.dispatch(setConfig({} as any));
    store.dispatch({ type: 'chatSettingStore/setActiveModal', payload: undefined });
  });
  const handleCloseModal = jest.fn();
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <UserSettingsModal handleCloseModal={handleCloseModal} />
      </Provider>
    );
  });
  const node = (id: string) => tree.root.find((n) => n.props?.testID === id);
  const texts = () =>
    tree.root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((c) => typeof c === 'string') as string[];
  return { tree, node, texts, handleCloseModal };
};

describe('Settings screen', () => {
  it('gives each destination its own card', async () => {
    const { node, texts } = await render();
    const cards = [MODAL_TYPES.MANAGE_DATA, MODAL_TYPES.VISIBILITY].map((key) =>
      node(`settings-row-${key}`)
    );
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      const style = Object.assign(
        {},
        ...(Array.isArray(card.props.style) ? card.props.style : [card.props.style])
          .flat()
          .filter(Boolean)
      );
      expect(style.backgroundColor).toBe('#FFFFFF');
      expect(style.borderRadius).toBeGreaterThanOrEqual(16);
      // A card, not a row in a bordered block: it carries its own shadow.
      expect(style.shadowOpacity).toBeGreaterThan(0);
    }
    expect(texts()).toEqual(expect.arrayContaining(['Manage Data', 'Visibility']));
  });

  it('opens the matching modal when a card is tapped', async () => {
    const { node } = await render();
    await act(async () => {
      node(`settings-row-${MODAL_TYPES.VISIBILITY}`).props.onPress();
    });
    expect(store.getState().chatSettingStore.activeModal).toBe(
      MODAL_TYPES.VISIBILITY
    );
  });
});
