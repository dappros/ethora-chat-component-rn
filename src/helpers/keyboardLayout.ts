type KeyboardLayoutArgs = {
  platform: string;
  configuredOffset?: number;
  bottomInset?: number;
  keyboardVisible?: boolean;
};

export const ANDROID_INPUT_DOCK_GAP = 12;
// Bottom padding the dock keeps while the iOS keyboard is open, so the
// composer is glued to the keyboard without touching its edge.
export const IOS_KEYBOARD_DOCK_GAP = 4;

export const getKeyboardVerticalOffset = ({
  platform,
  configuredOffset = 0,
  bottomInset = 0,
}: KeyboardLayoutArgs): number =>
  configuredOffset + (platform === 'ios' ? bottomInset : 0);

// Offset for the KeyboardAvoidingView strategy. Unlike KeyboardStickyView
// (where a positive `opened` offset pushes the dock DOWN into the keyboard),
// a positive value here ADDS bottom padding above the keyboard — so the
// safe-area inset must not be added: the avoiding view already ends exactly
// at the keyboard's top edge.
export const getKeyboardAvoidingOffset = ({
  configuredOffset = 0,
}: Pick<KeyboardLayoutArgs, 'configuredOffset'>): number => configuredOffset;

// Dock bottom padding while the keyboard is open (KeyboardAvoidingView
// strategy). On iOS the safe-area padding collapses to a small gap; Android
// keeps its fixed gap.
export const getInputDockKeyboardPadding = ({
  platform,
  inputDockPaddingBottom,
}: {
  platform: string;
  inputDockPaddingBottom: number;
}): number =>
  platform === 'ios'
    ? Math.min(inputDockPaddingBottom, IOS_KEYBOARD_DOCK_GAP)
    : inputDockPaddingBottom;

type InputDockPaddingArgs = Omit<KeyboardLayoutArgs, 'configuredOffset'> & {
  // Explicit `inputDockPaddingBottom` config value, verbatim on both
  // platforms when provided (0 allowed). Takes priority over every other
  // rule below, including `hostOwnsLayout`.
  configuredPadding?: number;
  // True when the host app owns keyboard layout entirely (i.e.
  // `disableKeyboardAvoidingView` is set) and `configuredPadding` was not
  // given. The dock then gets no built-in bottom padding of its own,
  // since it already sits above the host's own chrome (e.g. its tab bar).
  hostOwnsLayout?: boolean;
};

export const getInputDockPaddingBottom = ({
  platform,
  bottomInset = 0,
  keyboardVisible = false,
  configuredPadding,
  hostOwnsLayout = false,
}: InputDockPaddingArgs): number => {
  if (typeof configuredPadding === 'number') {
    return configuredPadding;
  }
  if (hostOwnsLayout) {
    return 0;
  }
  return platform === 'ios' ? bottomInset : ANDROID_INPUT_DOCK_GAP;
};
