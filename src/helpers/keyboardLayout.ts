type KeyboardLayoutArgs = {
  platform: string;
  configuredOffset?: number;
  bottomInset?: number;
};

export const getKeyboardVerticalOffset = ({
  platform,
  configuredOffset = 0,
  bottomInset = 0,
}: KeyboardLayoutArgs): number =>
  configuredOffset + (platform === 'ios' ? bottomInset : 0);

export const getInputDockPaddingBottom = ({
  platform,
  bottomInset = 0,
}: Omit<KeyboardLayoutArgs, 'configuredOffset'>): number =>
  platform === 'ios' ? bottomInset : 0;
