/**
 * Expo Config Plugin for @ethora/chat-component
 * 
 * This plugin automatically configures:
 * - iOS permissions (Info.plist)
 * - Android permissions (AndroidManifest.xml)
 * - Native module linking
 */

const { withInfoPlist, withAndroidManifest } = require('@expo/config-plugins');

const withChatComponent = (config) => {
  // iOS Configuration
  config = withInfoPlist(config, (config) => {
    const permissions = [
      {
        key: 'NSCameraUsageDescription',
        value: 'This app needs access to your camera to take photos for chat.',
      },
      {
        key: 'NSPhotoLibraryUsageDescription',
        value: 'This app needs access to your photo library to select images for chat.',
      },
      {
        key: 'NSPhotoLibraryAddUsageDescription',
        value: 'This app needs access to save photos to your library.',
      },
      {
        key: 'NSMicrophoneUsageDescription',
        value: 'This app needs access to your microphone to record audio messages.',
      },
    ];

    permissions.forEach(({ key, value }) => {
      if (!config.modResults[key]) {
        config.modResults[key] = value;
      }
    });

    return config;
  });

  // Android Configuration
  config = withAndroidManifest(config, (config) => {
    const androidManifest = config.modResults.manifest;
    const { manifest } = androidManifest;

    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }

    const permissions = [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.READ_MEDIA_AUDIO',
    ];

    permissions.forEach((permission) => {
      const existingPermission = manifest['uses-permission'].find(
        (p) => p.$['android:name'] === permission
      );

      if (!existingPermission) {
        manifest['uses-permission'].push({
          $: { 'android:name': permission },
        });
      }
    });

    return config;
  });

  return config;
};

module.exports = withChatComponent;

