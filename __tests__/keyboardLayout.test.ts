import {
  getKeyboardVerticalOffset,
  getInputDockPaddingBottom,
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

  it('pads the input dock by the safe-area inset on iOS only', () => {
    expect(
      getInputDockPaddingBottom({
        platform: 'ios',
        bottomInset: 34,
      })
    ).toBe(34);
    expect(
      getInputDockPaddingBottom({
        platform: 'android',
        bottomInset: 34,
      })
    ).toBe(0);
  });
});
