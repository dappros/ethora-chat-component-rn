// expo-haptics is an OPTIONAL peer, probed the same way as expo-blur: the JS
// package alone is not enough, the native module has to be in the binary,
// otherwise the call throws. Without it the gesture simply has no feedback.
let Haptics: any = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  requireNativeModule('ExpoHaptics');
  Haptics = require('expo-haptics');
} catch {
  Haptics = null;
}

/** Short tap, the messenger "I got your long-press" feedback. Never throws. */
export const hapticTap = () => {
  if (!Haptics) {
    return;
  }
  Haptics.impactAsync?.(Haptics.ImpactFeedbackStyle?.Medium).catch?.(() => {});
};
