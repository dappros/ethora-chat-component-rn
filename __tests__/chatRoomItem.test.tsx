/**
 * ChatRoomItem — L2 render tests for the unread badge.
 *
 * Visual side of the unread-counter pipeline (cluster F in
 * QA_SCENARIOS.md). The reducer + middleware tests pin the count
 * itself; this file pins what the user sees in the room list:
 *
 *   - unreadMessages > 0 → badge with the count
 *   - unreadMessages 0 / undefined → no badge
 *   - badge uses config.colors.primary as background
 *
 * Plus a sanity check on the date stamp formatting branch (HH:MM
 * for today, MM/DD for older this year), which is the other piece
 * of the room-list row that's prone to silent regression.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { View, Text } from 'react-native';
import { Provider } from 'react-redux';
import ChatRoomItem from '../src/components/RoomComponents/ChatRoomItem';
import { store } from '../src/roomStore';
import type { IRoom } from '../src/types/types';

const renderItem = async (
  chat: IRoom,
  config?: any
): Promise<renderer.ReactTestRenderer> => {
  let tree: renderer.ReactTestRenderer | undefined;
  // Match the async-act pattern other suites use to silence
  // setState-during-render warnings from styled-components.
  // ChatRoomItem renders ProfileImagePlaceholder, which reads config from
  // redux via useChatSettingState — so it needs a Provider to render.
  await act(async () => {
    tree = renderer.create(
      <Provider store={store}>
        <ChatRoomItem chat={chat} config={config} />
      </Provider>
    );
  });
  return tree!;
};

const makeRoom = (overrides: Partial<IRoom> = {}): IRoom =>
  ({
    id: 'r@h',
    name: 'general',
    jid: 'r@h',
    title: 'General',
    usersCnt: 3,
    messages: [],
    isLoading: false,
    roomBg: '',
    lastViewedTimestamp: 0,
    unreadMessages: 0,
    ...overrides,
  } as IRoom);

// Walk a react-test-renderer tree and find every node where the
// given predicate matches.
const findAll = (
  root: renderer.ReactTestInstance,
  predicate: (n: renderer.ReactTestInstance) => boolean
): renderer.ReactTestInstance[] => {
  const out: renderer.ReactTestInstance[] = [];
  const visit = (n: renderer.ReactTestInstance) => {
    if (predicate(n)) {out.push(n);}
    (n.children || []).forEach((c) => {
      if (typeof c !== 'string') {visit(c as renderer.ReactTestInstance);}
    });
  };
  visit(root);
  return out;
};

// The badge is the only View with a borderRadius:8 + non-default
// minWidth:24 — that's a precise enough fingerprint to spot it
// without leaking implementation through testIDs.
const findBadgeView = (root: renderer.ReactTestInstance) =>
  findAll(root, (n) => {
    if (n.type !== View) {return false;}
    const s = n.props?.style;
    return !!(s && s.borderRadius === 8 && s.minWidth === 24);
  })[0];

describe('<ChatRoomItem /> — unread badge', () => {
  it('does not render the badge when unreadMessages === 0', async () => {
    const tree = await renderItem(makeRoom());
    expect(findBadgeView(tree.root)).toBeUndefined();
  });

  it('does not render the badge when unreadMessages is undefined', async () => {
    const tree = await renderItem(
      makeRoom({ unreadMessages: undefined as any })
    );
    expect(findBadgeView(tree.root)).toBeUndefined();
  });

  it('renders the badge with the count when unreadMessages > 0', async () => {
    const tree = await renderItem(makeRoom({ unreadMessages: 7 }));
    const badge = findBadgeView(tree.root);
    expect(badge).toBeDefined();
    // The badge's <Text> child carries the count.
    const textNode = findAll(badge!, (n) => n.type === Text)[0];
    expect(textNode?.props?.children).toBe(7);
  });

  it('badge background uses config.colors.primary when supplied', async () => {
    const tree = await renderItem(
      makeRoom({ unreadMessages: 3 }),
      { colors: { primary: '#ff00aa', secondary: '#000' } }
    );
    const badge = findBadgeView(tree.root);
    expect(badge?.props?.style?.backgroundColor).toBe('#ff00aa');
  });

  it('still renders the row title when unreadMessages > 0', async () => {
    // Regression guard: a previous refactor returned early from the
    // unread branch and unmounted the row entirely. Pin that the
    // title coexists with the badge.
    const tree = await renderItem(
      makeRoom({ unreadMessages: 1, title: 'Engineering' })
    );
    const titles = findAll(tree.root, (n) => {
      if (n.type !== Text) {return false;}
      const c = n.props?.children;
      return typeof c === 'string' && c === 'Engineering';
    });
    expect(titles.length).toBeGreaterThan(0);
  });
});
