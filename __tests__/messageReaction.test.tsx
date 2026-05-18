/**
 * MessageReaction — L2 render contract for the per-message reaction
 * row (emoji chip + count, with the "you reacted" highlight).
 *
 * Source uses `Animated.Value` + microtask `Animated.timing` for the
 * tooltip; we don't drive the animation here, just the static render
 * tree it produces at mount.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';
import { MessageReaction } from '../src/components/MessageBubble/MessageReaction';

const renderRow = async (
  props: React.ComponentProps<typeof MessageReaction>
): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<MessageReaction {...props} />);
  });
  return tree!;
};

// Reaction map shape: per-stanza id, with an `emoji: string[]` list
// of which emoji codes that stanza voted for, plus sender info under
// `data`. Multiple stanzas can vote for the same emoji.
const stanza = (codes: string[], first: string, last = 'X') => ({
  emoji: codes,
  data: { senderFirstName: first, senderLastName: last },
});

describe('<MessageReaction />', () => {
  it('returns null when `reaction` is missing entirely', async () => {
    const tree = await renderRow({
      reaction: undefined as any,
      color: '#0052CD',
      changeReaction: jest.fn(),
    });
    expect(tree.root.findAllByType(Text).length).toBe(0);
  });

  it('renders one chip per emoji with the correct emoji glyph + count', async () => {
    const tree = await renderRow({
      reaction: {
        s1: stanza(['joy'], 'A'),
        s2: stanza(['joy'], 'B'),
        s3: stanza(['heart'], 'C'),
      },
      color: '#0052CD',
      changeReaction: jest.fn(),
    });
    const texts = tree.root
      .findAllByType(Text)
      .map((t) => t.props.children)
      .filter((c) => typeof c === 'string' || typeof c === 'number');
    // The emojiMap should turn 'joy' → 😂 and 'heart' → ❤️
    expect(texts).toEqual(expect.arrayContaining(['😂', '❤️', 2, 1]));
  });

  it('renders the raw emoji string when not in the emojiMap', async () => {
    const tree = await renderRow({
      reaction: { s1: stanza(['🦄'], 'A') },
      color: '#0052CD',
      changeReaction: jest.fn(),
    });
    const texts = tree.root
      .findAllByType(Text)
      .map((t) => t.props.children);
    expect(texts).toContain('🦄');
  });

  it('marks the current user as having reacted when their name is in the users list', async () => {
    const tree = await renderRow({
      reaction: { s1: stanza(['joy'], 'Alice', 'Anderson') },
      color: '#ff00aa',
      userName: 'Alice Anderson',
      changeReaction: jest.fn(),
    });
    // The styled ReactionBox sets `active={true}` and the count Text
    // switches to white on the brand color background.
    const activeChips = tree.root.findAll(
      (n) => n.props?.active === true && typeof n.props?.color === 'string'
    );
    expect(activeChips.length).toBeGreaterThan(0);
  });

  it('fires changeReaction(emoji) when the chip is tapped', async () => {
    const onChange = jest.fn();
    const tree = await renderRow({
      reaction: { s1: stanza(['heart'], 'A') },
      color: '#0052CD',
      changeReaction: onChange,
    });
    const tappable = tree.root.findAllByType(TouchableOpacity)[0];
    act(() => {
      tappable.props.onPress();
    });
    expect(onChange).toHaveBeenCalledWith('heart');
  });

  it('aggregates the same emoji across multiple stanzas into one chip', async () => {
    const tree = await renderRow({
      reaction: {
        s1: stanza(['fire'], 'A'),
        s2: stanza(['fire'], 'B'),
        s3: stanza(['fire'], 'C'),
        s4: stanza(['+1'], 'D'),
      },
      color: '#0052CD',
      changeReaction: jest.fn(),
    });
    // Two emoji groups → two tappable chips.
    const chips = tree.root.findAllByType(TouchableOpacity);
    expect(chips.length).toBe(2);
    // Counts present: 3 (fire) + 1 (+1)
    const childCounts = tree.root
      .findAllByType(Text)
      .map((t) => t.props.children)
      .filter((c) => typeof c === 'number');
    expect(childCounts).toEqual(expect.arrayContaining([3, 1]));
  });
});
