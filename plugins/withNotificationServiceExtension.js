/**
 * Expo config plugin — adds an iOS Notification Service Extension that shows
 * the attachment thumbnail (photo / video preview) in chat pushes.
 *
 * The push service sends `previewUrl` with `mutable-content: 1`. Android
 * renders the picture by itself; iOS only does it through an extension
 * target inside the app, which downloads the file and attaches it
 * (plugins/notification-service/NotificationService.swift).
 *
 * An extension is a separate target signed with the app, so it cannot ship
 * inside the npm package as code: this plugin writes it into ios/ on every
 * `expo prebuild` (the generated ios/ folder is gitignored in Expo apps).
 *
 * Host app.json:
 *   "plugins": ["@ethora/chat-component-rn"]
 * or with options:
 *   "plugins": [["@ethora/chat-component-rn", { "appleTeamId": "ABCDE12345" }]]
 *
 * Options:
 *   appleTeamId  signing team of the extension; default: ios.appleTeamId,
 *                else the team already set on the app target in Xcode.
 */

const fs = require('fs');
const path = require('path');
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'EthoraNotificationService';
const SOURCE_DIR = path.join(__dirname, 'notification-service');
const FILES = ['NotificationService.swift', 'Info.plist'];

const extensionBundleId = (config) => {
  const appBundleId = config.ios && config.ios.bundleIdentifier;
  if (!appBundleId) {
    throw new Error(
      '[@ethora/chat-component-rn] ios.bundleIdentifier is required for the notification service extension'
    );
  }
  return `${appBundleId}.${TARGET_NAME}`;
};

// EAS Build creates signing credentials only for targets it knows about.
const withEasAppExtension = (config) => {
  const bundleIdentifier = extensionBundleId(config);
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental || {};
  const ios = (config.extra.eas.build.experimental.ios =
    config.extra.eas.build.experimental.ios || {});
  const extensions = (ios.appExtensions = ios.appExtensions || []);
  if (!extensions.some((ext) => ext.targetName === TARGET_NAME)) {
    extensions.push({ targetName: TARGET_NAME, bundleIdentifier, entitlements: {} });
  }
  return config;
};

// Copied on every prebuild so an SDK update reaches the app.
const withExtensionFiles = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const dest = path.join(cfg.modRequest.platformProjectRoot, TARGET_NAME);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of FILES) {
        fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(dest, file));
      }
      return cfg;
    },
  ]);

const unquote = (value) => (typeof value === 'string' ? value.replace(/^"(.*)"$/, '$1') : value);

const targetBuildSettings = (project, targetUuid) => {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const list = target && project.pbxXCConfigurationList()[target.buildConfigurationList];
  const configs = project.pbxXCBuildConfigurationSection();
  return ((list && list.buildConfigurations) || [])
    .map((ref) => configs[ref.value])
    .filter((entry) => entry && entry.buildSettings)
    .map((entry) => entry.buildSettings);
};

const withExtensionTarget = (config, { appleTeamId } = {}) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const bundleIdentifier = extensionBundleId(cfg);

    const appTarget = project.getFirstTarget();
    const appSettings = targetBuildSettings(project, appTarget.uuid)[0] || {};
    const team = appleTeamId || (cfg.ios && cfg.ios.appleTeamId) || unquote(appSettings.DEVELOPMENT_TEAM);

    let targetUuid = project.findTargetKey(`"${TARGET_NAME}"`) || project.findTargetKey(TARGET_NAME);
    if (!targetUuid) {
      // xcode's addTarget expects these sections to exist.
      const objects = project.hash.project.objects;
      objects.PBXTargetDependency = objects.PBXTargetDependency || {};
      objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

      const group = project.addPbxGroup(FILES, TARGET_NAME, TARGET_NAME);
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addToPbxGroup(group.uuid, mainGroup);

      // 'app_extension' also embeds the .appex into the app (Copy Files to
      // PlugIns) and makes the app depend on it.
      const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleIdentifier);
      project.addBuildPhase(['NotificationService.swift'], 'PBXSourcesBuildPhase', 'Sources', target.uuid);
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', target.uuid);
      targetUuid = target.uuid;
    }

    for (const settings of targetBuildSettings(project, targetUuid)) {
      Object.assign(settings, {
        PRODUCT_NAME: `"${TARGET_NAME}"`,
        PRODUCT_BUNDLE_IDENTIFIER: `"${bundleIdentifier}"`,
        INFOPLIST_FILE: `"${TARGET_NAME}/Info.plist"`,
        GENERATE_INFOPLIST_FILE: 'NO',
        SWIFT_VERSION: appSettings.SWIFT_VERSION || '5.0',
        IPHONEOS_DEPLOYMENT_TARGET: appSettings.IPHONEOS_DEPLOYMENT_TARGET || '15.1',
        TARGETED_DEVICE_FAMILY: appSettings.TARGETED_DEVICE_FAMILY || '"1,2"',
        // Must match the app, App Store Connect rejects a mismatch.
        MARKETING_VERSION: cfg.version || appSettings.MARKETING_VERSION || '1.0.0',
        CURRENT_PROJECT_VERSION: (cfg.ios && cfg.ios.buildNumber) || appSettings.CURRENT_PROJECT_VERSION || '1',
        CODE_SIGN_STYLE: 'Automatic',
        CLANG_ENABLE_MODULES: 'YES',
        SKIP_INSTALL: 'YES',
      });
      if (team) settings.DEVELOPMENT_TEAM = team;
    }
    return cfg;
  });

const withNotificationServiceExtension = (config, props = {}) =>
  withExtensionTarget(withExtensionFiles(withEasAppExtension(config)), props);

module.exports = withNotificationServiceExtension;
