import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Animated, Modal, Platform } from 'react-native';
import { Provider } from 'react-redux';
import AttachSheet from '../src/components/Modals/AttachSheet/AttachSheet';
import { store } from '../src/roomStore';

type EndCb = (r: { finished: boolean }) => void;

let animationEnd: EndCb | null = null;
let parallelSpy: jest.SpyInstance;
const originalOS = Platform.OS;

beforeEach(() => {
  animationEnd = null;
  parallelSpy = jest.spyOn(Animated, 'parallel').mockImplementation(
    () =>
      ({
        start: (cb?: EndCb) => {
          animationEnd = cb ?? null;
        },
        stop: () => {},
        reset: () => {},
      } as any)
  );
});

afterEach(() => {
  parallelSpy.mockRestore();
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

const setOS = (os: 'ios' | 'android') =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const render = async (visible: boolean, handlers: { onDocument: () => void }) => {
  let tree!: renderer.ReactTestRenderer;
  const props = {
    onClose: jest.fn(),
    onCamera: jest.fn(),
    onGallery: jest.fn(),
    ...handlers,
  };
  const element = (v: boolean) => (
    <Provider store={store}>
      <AttachSheet visible={v} {...props} />
    </Provider>
  );
  await act(async () => {
    tree = renderer.create(element(true));
  });
  const rerender = async (v: boolean) => {
    await act(async () => {
      tree.update(element(v));
    });
  };
  if (!visible) {await rerender(false);}
  return { tree, props, rerender };
};

const tapDocument = async (tree: renderer.ReactTestRenderer) => {
  const row = tree.root.find((n) => n.props?.testID === 'attach-row-Document');
  await act(async () => {
    row.props.onPress();
  });
};

const finishExitAnimation = async (finished = true) => {
  expect(animationEnd).toBeTruthy();
  await act(async () => {
    animationEnd!({ finished });
  });
};

const modalOf = (tree: renderer.ReactTestRenderer) =>
  tree.root.findByType(Modal);

describe('AttachSheet pending handler timing', () => {
  it('iOS: handler fires from Modal.onDismiss, not before', async () => {
    setOS('ios');
    const onDocument = jest.fn();
    const { tree, props, rerender } = await render(true, { onDocument });

    await tapDocument(tree);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(onDocument).not.toHaveBeenCalled();

    expect(modalOf(tree).props.visible).toBe(false);

    await rerender(false);
    expect(animationEnd).toBeNull();
    expect(onDocument).not.toHaveBeenCalled();

    await act(async () => {
      modalOf(tree).props.onDismiss();
    });
    expect(onDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      modalOf(tree).props.onDismiss();
    });
    expect(onDocument).toHaveBeenCalledTimes(1);
  });

  it('iOS: Cancel / backdrop close still animates and never fires a handler', async () => {
    setOS('ios');
    const onDocument = jest.fn();
    const { tree, props, rerender } = await render(true, { onDocument });
    await act(async () => {
      tree.root.find((n) => n.props?.testID === 'attach-backdrop').props.onPress();
    });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(modalOf(tree).props.visible).toBe(true);
    await rerender(false);
    await finishExitAnimation();
    expect(modalOf(tree).props.visible).toBe(false);
    await act(async () => {
      modalOf(tree).props.onDismiss();
    });
    expect(onDocument).not.toHaveBeenCalled();
  });

  it('Android: handler fires once the exit animation completes (no onDismiss)', async () => {
    setOS('android');
    const onDocument = jest.fn();
    const { tree, rerender } = await render(true, { onDocument });

    await tapDocument(tree);
    expect(onDocument).not.toHaveBeenCalled();

    await rerender(false);
    expect(onDocument).not.toHaveBeenCalled();

    await finishExitAnimation();
    expect(onDocument).toHaveBeenCalledTimes(1);
    expect(modalOf(tree).props.onDismiss).toBeUndefined();
  });

  it('Android: interrupted exit animation does not fire the handler', async () => {
    setOS('android');
    const onDocument = jest.fn();
    const { tree, rerender } = await render(true, { onDocument });
    await tapDocument(tree);
    await rerender(false);
    await finishExitAnimation(false);
    expect(onDocument).not.toHaveBeenCalled();
  });
});
