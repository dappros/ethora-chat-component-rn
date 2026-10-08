import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { Provider } from 'react-redux';
import { store } from '../src/roomStore';
import { SearchInput } from '../src/components/InputComponents/Search';

const render = async (value: string, onChangeText = jest.fn()) => {
  let tree!: renderer.ReactTestRenderer;
  const focus = jest.fn();
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <SearchInput value={value} onChangeText={onChangeText} />
      </Provider>,
      { createNodeMock: () => ({ focus }) }
    );
  });
  const clear = () =>
    tree.root.findAll(
      (n) => n.props?.testID === 'search-clear' && typeof n.type !== 'string'
    );
  return { tree, clear, onChangeText, focus };
};

describe('SearchInput clear button', () => {
  it('is absent while the field is empty', async () => {
    const { clear } = await render('');
    expect(clear()).toHaveLength(0);
  });

  it('shows with an accessible label and a 28pt touch area when there is text', async () => {
    const { clear } = await render('abc');
    const btn = clear()[0];
    expect(btn.props.accessibilityLabel).toBe('Clear search');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.hitSlop).toBeTruthy();
    const style = Object.assign({}, ...[btn.props.style].flat().filter(Boolean));
    expect(style.width).toBeGreaterThanOrEqual(28);
    expect(style.height).toBeGreaterThanOrEqual(28);
  });

  it('clears the text and keeps focus', async () => {
    const { clear, onChangeText, tree } = await render('abc');
    const input = tree.root.findAll((n) => n.type === TextInput && n.instance)[0];
    const spy = jest.spyOn(input.instance, 'focus');
    await act(async () => {
      clear()[0].props.onPress();
    });
    expect(onChangeText).toHaveBeenCalledWith('');
    expect(spy).toHaveBeenCalled();
  });
});
