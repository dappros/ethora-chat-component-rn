import {
  getKeyboardVerticalOffset,
  getKeyboardAvoidingOffset,
  getInputDockKeyboardPadding,
  IOS_KEYBOARD_DOCK_GAP,
  getInputDockPaddingBottom,
  ANDROID_INPUT_DOCK_GAP,
} from '../src/helpers/keyboardLayout';

describe('keyboardLayout', () => {
  it('adds the iOS bottom inset to the keyboard offset so home-indicator devices do not get an extra gap', () => {
    expect(
      getKeyboardVerticalOffset({
        platform: 'ios',
        configuredOffset: 12,
        bottomInset: 34,
      })
    ).toBe(46);
  });

  it('adds only the part of the Android inset above the fixed gap', () => {
    expect(
      getKeyboardVerticalOffset({
        platform: 'android',
        configuredOffset: 12,
        bottomInset: 48,
      })
    ).toBe(12 + 48 - ANDROID_INPUT_DOCK_GAP);
    expect(
      getKeyboardVerticalOffset({
        platform: 'android',
        configuredOffset: 12,
        bottomInset: 0,
      })
    ).toBe(12);
  });

  it('does not add the bottom inset to the avoiding-view offset', () => {
    expect(getKeyboardAvoidingOffset({ configuredOffset: 12 })).toBe(12);
    expect(getKeyboardAvoidingOffset({})).toBe(0);
  });

  it('collapses the iOS dock padding to a small gap while the keyboard is open', () => {
    expect(
      getInputDockKeyboardPadding({ platform: 'ios', inputDockPaddingBottom: 34 })
    ).toBe(IOS_KEYBOARD_DOCK_GAP);
    expect(
      getInputDockKeyboardPadding({ platform: 'ios', inputDockPaddingBottom: 0 })
    ).toBe(0);
  });

  it('collapses the Android dock padding to the fixed gap while the keyboard is open', () => {
    expect(
      getInputDockKeyboardPadding({
        platform: 'android',
        inputDockPaddingBottom: 48,
      })
    ).toBe(ANDROID_INPUT_DOCK_GAP);
    expect(
      getInputDockKeyboardPadding({
        platform: 'android',
        inputDockPaddingBottom: 0,
      })
    ).toBe(0);
  });

  it('pads the input dock by the safe-area inset on iOS', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
      })
    ).toBe(34);
  });

  it('pads the input dock above the Android navigation bar (edge-to-edge)', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 48,
      })
    ).toBe(48);
  });

  it('keeps a small fixed gap on Android when there is no bottom inset', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 0,
      })
    ).toBe(ANDROID_INPUT_DOCK_GAP);
  });

  it('uses an explicit configuredPadding of 0 verbatim on iOS', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
        configuredPadding: 0,
      })
    ).toBe(0);
  });

  it('uses an explicit configuredPadding of 0 verbatim on Android', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 34,
        configuredPadding: 0,
      })
    ).toBe(0);
  });

  it('uses an explicit non-zero configuredPadding verbatim on both platforms', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
        configuredPadding: 8,
      })
    ).toBe(8);
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 34,
        configuredPadding: 8,
      })
    ).toBe(8);
  });

  it('pads with 0 when the host owns layout (disableKeyboardAvoidingView) and no explicit padding is given', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
        hostOwnsLayout: true,
      })
    ).toBe(0);
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 34,
        hostOwnsLayout: true,
      })
    ).toBe(0);
  });

  it('prefers an explicit configuredPadding over hostOwnsLayout', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
        hostOwnsLayout: true,
        configuredPadding: 6,
      })
    ).toBe(6);
  });
});
