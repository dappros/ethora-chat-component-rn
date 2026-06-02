import {
  getKeyboardVerticalOffset,
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

  it('does not add a bottom inset on Android', () => {
    expect(
      getKeyboardVerticalOffset({
        platform: 'android',
        configuredOffset: 12,
        bottomInset: 34,
      })
    ).toBe(12);
  });

  it('pads the input dock by the safe-area inset on iOS', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
      })
    ).toBe(34);
  });

  it('pads the input dock by a small fixed gap on Android so the input is not flush against the keyboard', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 34,
      })
    ).toBe(ANDROID_INPUT_DOCK_GAP);
  });
});
