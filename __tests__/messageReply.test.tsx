/**
 * MessageReply — L2 render contract for the reply-quote chip that
 * appears above a message bubble pointing at the message it replies
 * to. Tappable; isUser-styled.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { MessageReply } from '../src/components/MessageBubble/MessageReply';

const renderReply = async (
  props: React.ComponentProps<typeof MessageReply>
): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<MessageReply {...props} />);
  });
  return tree!;
};

// The accent bar is the quote's first child view; its colour is the accent.
const flat = (style: any) =>
  Array.isArray(style) ? Object.assign({}, ...style.flat().filter(Boolean)) : style || {};
const accentOf = (tree: any) => {
  const quote = tree.root.findByProps({ testID: 'message-reply-quote' });
  const bar = quote.findAll((n: any) => n.type === 'View' && flat(n.props.style).width === 4)[0];
  return flat(bar?.props?.style).backgroundColor;
};

describe('<MessageReply />', () => {
  it('renders the quoted text', async () => {
    const tree = await renderReply({
      isUser: false,
      text: 'original message text',
      handleReplyMessage: jest.fn(),
    });
    const labels = tree.root
      .findAllByType(Text)
      .map((t) => t.props.children)
      .filter((c) => typeof c === 'string');
    expect(labels).toContain('original message text');
  });

  it('fires handleReplyMessage when tapped', async () => {
    const onReply = jest.fn();
    const tree = await renderReply({
      isUser: false,
      text: 'tap me',
      handleReplyMessage: onReply,
    });
    // The styled TouchableOpacity exposes onPress on the wrapping
    // styled component; find any node with an onPress prop and
    // invoke it.
    const tappable = tree.root.findAll(
      (n) => typeof n.props?.onPress === 'function'
    )[0];
    expect(tappable).toBeDefined();
    act(() => {
      tappable.props.onPress();
    });
    expect(onReply).toHaveBeenCalledTimes(1);
  });

  it('defaults `color` to the brand primary when none provided', async () => {
    const tree = await renderReply({
      isUser: true,
      text: 'x',
      handleReplyMessage: jest.fn(),
    });
    expect(accentOf(tree)).toBe('#0052CD');
  });

  it('forwards an explicit color prop to the styled wrapper', async () => {
    const tree = await renderReply({
      isUser: true,
      text: 'x',
      color: '#ff00aa',
      handleReplyMessage: jest.fn(),
    });
    expect(accentOf(tree)).toBe('#ff00aa');
  });

  it('isUser flag propagates so the styled border swaps sides', async () => {
    const own = await renderReply({
      isUser: true,
      text: 'own',
      handleReplyMessage: jest.fn(),
    });
    const ownWrapper = own.root.findAll(
      (n) => typeof n.props?.isUser === 'boolean'
    )[0];
    expect(ownWrapper?.props?.isUser).toBe(true);

    const other = await renderReply({
      isUser: false,
      text: 'other',
      handleReplyMessage: jest.fn(),
    });
    const otherWrapper = other.root.findAll(
      (n) => typeof n.props?.isUser === 'boolean'
    )[0];
    expect(otherWrapper?.props?.isUser).toBe(false);
  });
});
