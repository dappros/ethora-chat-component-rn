type KeyboardLayoutArgs = {
  platform: string;
  configuredOffset?: number;
  bottomInset?: number;
  keyboardVisible?: boolean;
};

export const ANDROID_INPUT_DOCK_GAP = 12;

export const getKeyboardVerticalOffset = ({
  platform,
  configuredOffset = 0,
  bottomInset = 0,
}: KeyboardLayoutArgs): number =>
  configuredOffset + (platform === 'ios' ? bottomInset : 0);

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
