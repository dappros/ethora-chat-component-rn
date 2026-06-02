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

export const getInputDockPaddingBottom = ({
  platform,
  bottomInset = 0,
  keyboardVisible = false,
}: Omit<KeyboardLayoutArgs, 'configuredOffset'>): number =>
  platform === 'ios' ? bottomInset : ANDROID_INPUT_DOCK_GAP;
