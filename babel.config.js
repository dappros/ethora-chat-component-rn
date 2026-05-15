// Expo SDK 54 / RN 0.81 / React 19. The `babel-preset-expo` preset
// handles the babel pipeline (including Reanimated 4's worklets
// plugin, which used to require a separate `react-native-reanimated/
// plugin` entry — now bundled).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
