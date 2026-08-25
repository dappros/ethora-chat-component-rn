/**
 * ProfileImagePlaceholder — what may reach <Image source>.
 *
 * The avatar's upload callback is wired to `onPress`, so React Native
 * hands it a SyntheticEvent. Two screens used to store that event as
 * "the image": it rendered as an <Image source>, and when React released
 * the pooled event the app died with "Property is not configurable".
 * Anything that isn't a real source must fall back to the initials.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Image } from 'react-native';
import { Provider as ReduxProvider } from 'react-redux';
import { store } from '../src/roomStore';
import { ProfileImagePlaceholder } from '../src/components/MainComponents/ProfileImagePlaceholder';

const render = (props: any) => {
  let tree: renderer.ReactTestRenderer;
  act(() => {
    tree = renderer.create(
      <ReduxProvider store={store}>
        <ProfileImagePlaceholder name="Ada Lovelace" size={64} {...props} />
      </ReduxProvider>
    );
  });
  return tree!;
};

const imageSources = (tree: renderer.ReactTestRenderer) =>
  tree.root.findAllByType(Image).map((n) => n.props.source);

describe('ProfileImagePlaceholder — avatar source', () => {
  it('renders a url string as { uri }', () => {
    const tree = render({ icon: 'https://cdn.example.com/a.jpg' });
    expect(imageSources(tree)).toContainEqual({
      uri: 'https://cdn.example.com/a.jpg',
    });
  });

  it('renders a { uri } object as-is', () => {
    const source = { uri: 'file:///tmp/pick.jpg', type: 'image/jpeg' };
    const tree = render({ icon: source });
    expect(imageSources(tree)).toContainEqual(source);
  });

  it('does NOT pass a press event through as an image source', () => {
    // The exact shape that crashed: a pooled SyntheticEvent.
    const syntheticEvent = {
      nativeEvent: { locationX: 1 },
      persist() {},
      preventDefault() {},
      stopPropagation() {},
    };

    const tree = render({ icon: syntheticEvent });

    expect(imageSources(tree)).not.toContainEqual(syntheticEvent);
    // ...and it falls back to the initials instead of rendering nothing.
    expect(JSON.stringify(tree.toJSON())).toContain('AL');
  });

  it('treats an empty string as NO image, not a blank one', () => {
    // `appendFileToken` returns '' for a room without an icon, so this is
    // the ordinary case for most chats — not an edge case. Rendering it
    // as { uri: '' } showed an empty <Image> AND swallowed the initials,
    // which wiped the avatars off the whole chat list.
    const tree = render({ icon: '' });

    expect(imageSources(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('AL');
  });

  it('treats { uri: "" } as NO image either', () => {
    const tree = render({ icon: { uri: '' } });

    expect(imageSources(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('AL');
  });

  it('falls back to initials for any other junk value', () => {
    for (const icon of [{}, { notAUri: 1 }, true, [] as any]) {
      const tree = render({ icon });
      expect(imageSources(tree)).toHaveLength(0);
    }
  });
});
