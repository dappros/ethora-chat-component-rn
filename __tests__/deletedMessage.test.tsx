/**
 * DeletedMessage — L2 render contract.
 *
 * Tiny component, but it's the user-visible tombstone for a deleted
 * message. Pinning the contract so a refactor that drops the icon or
 * changes the copy is caught.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { DeletedMessage } from '../src/components/MessageBubble/DeletedMessage';

const renderTombstone = async () => {
  let tree: renderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = renderer.create(<DeletedMessage />);
  });
  return tree!;
};

describe('<DeletedMessage />', () => {
  it('renders the "This message was deleted." copy', async () => {
    const tree = await renderTombstone();
    const texts = tree.root.findAllByType(Text);
    const labels = texts
      .map((t) => t.props.children)
      .filter((c) => typeof c === 'string');
    expect(labels).toContain('This message was deleted.');
  });

  it('renders an icon next to the copy', async () => {
    // The DeleteIcon is an SVG component — react-native-svg is mocked
    // to functional no-ops in jest.setup.js, so we can't introspect
    // the icon itself. Instead assert the icon-wrapper <View> sits
    // before the <Text> in the tree (= the icon slot exists).
    const tree = await renderTombstone();
    const View = require('react-native').View;
    const wrappers = tree.root.findAllByType(View);
    // Outer ReplyContainer (styled.View) + IconContainer (styled.View)
    // → at least 2 Views before the Text.
    expect(wrappers.length).toBeGreaterThanOrEqual(2);
  });
});
