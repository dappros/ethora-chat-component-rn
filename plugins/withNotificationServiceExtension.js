/**
 * Expo config plugin — adds an iOS Notification Service Extension for Ethora
 * chat pushes. The extension (plugins/notification-service/NotificationService.swift)
 *  - decrypts encrypted (sealed) pushes with the device key the app keeps in
 *    the keychain and shows the real title and text in place of the
 *    "New message" placeholder;
 *  - shows the attachment thumbnail (photo / video preview) the push service
 *    sends as `previewUrl`.
 *
 * An extension is a separate target signed with the app, so it cannot ship
 * inside the npm package as code: this plugin writes it into ios/ on every
 * `expo prebuild` (the generated ios/ folder is gitignored in Expo apps).
 * For the key to be readable from the extension, the app and the extension
 * share a keychain access group (`$(AppIdentifierPrefix)<bundle id>`, the
 * app's own default group, listed first so items the app writes without a
 * group — expo-secure-store's — land in it). The sealed box is opened in
 * plain Swift (SealedBox.swift: CryptoKit for X25519, the rest ported from
 * tweetnacl), so the extension needs no pod.
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
const { withDangerousMod, withEntitlementsPlist, withXcodeProject } = require('expo/config-plugins');

const TARGET_NAME = 'EthoraNotificationService';
const SOURCE_DIR = path.join(__dirname, 'notification-service');
const SOURCES = ['NotificationService.swift', 'SealedBox.swift'];
const FILES = [...SOURCES, 'Info.plist'];
const ENTITLEMENTS_FILE = `${TARGET_NAME}.entitlements`;
const KEYCHAIN_GROUPS_KEY = 'keychain-access-groups';

const appBundleId = (config) => {
  const bundleId = config.ios && config.ios.bundleIdentifier;
  if (!bundleId) {
    throw new Error(
      '[@ethora/chat-component-rn] ios.bundleIdentifier is required for the notification service extension'
    );
  }
  return bundleId;
};

const extensionBundleId = (config) => `${appBundleId(config)}.${TARGET_NAME}`;

/** The keychain access group shared by the app and the extension. */
const keychainGroup = (config) => `$(AppIdentifierPrefix)${appBundleId(config)}`;

const withSharedGroupFirst = (groups, group) => {
  const list = Array.isArray(groups) ? groups.filter((g) => g !== group) : [];
  return [group, ...list];
};

// EAS Build creates signing credentials only for targets it knows about.
const withEasAppExtension = (config) => {
  const bundleIdentifier = extensionBundleId(config);
  const group = keychainGroup(config);
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.build = config.extra.eas.build || {};
  config.extra.eas.build.experimental = config.extra.eas.build.experimental || {};
  const ios = (config.extra.eas.build.experimental.ios =
    config.extra.eas.build.experimental.ios || {});
  const extensions = (ios.appExtensions = ios.appExtensions || []);
  let entry = extensions.find((ext) => ext.targetName === TARGET_NAME);
  if (!entry) {
    entry = { targetName: TARGET_NAME, bundleIdentifier, entitlements: {} };
    extensions.push(entry);
  }
  entry.entitlements = entry.entitlements || {};
  entry.entitlements[KEYCHAIN_GROUPS_KEY] = withSharedGroupFirst(
    entry.entitlements[KEYCHAIN_GROUPS_KEY],
    group
  );
  return config;
};

// The app's side of the shared keychain group (Keychain Sharing capability).
const withAppKeychainGroup = (config) =>
  withEntitlementsPlist(config, (cfg) => {
    const group = keychainGroup(cfg);
    cfg.modResults[KEYCHAIN_GROUPS_KEY] = withSharedGroupFirst(
      cfg.modResults[KEYCHAIN_GROUPS_KEY],
      group
    );
    return cfg;
  });

const entitlementsPlist = (group) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>${KEYCHAIN_GROUPS_KEY}</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`;

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
      fs.writeFileSync(path.join(dest, ENTITLEMENTS_FILE), entitlementsPlist(keychainGroup(cfg)));
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

      const group = project.addPbxGroup([...FILES, ENTITLEMENTS_FILE], TARGET_NAME, TARGET_NAME);
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.addToPbxGroup(group.uuid, mainGroup);

      // 'app_extension' also embeds the .appex into the app (Copy Files to
      // PlugIns) and makes the app depend on it.
      const target = project.addTarget(TARGET_NAME, 'app_extension', TARGET_NAME, bundleIdentifier);
      project.addBuildPhase(SOURCES, 'PBXSourcesBuildPhase', 'Sources', target.uuid);
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
        CODE_SIGN_ENTITLEMENTS: `"${TARGET_NAME}/${ENTITLEMENTS_FILE}"`,
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
  withExtensionTarget(withExtensionFiles(withAppKeychainGroup(withEasAppExtension(config))), props);

module.exports = withNotificationServiceExtension;
