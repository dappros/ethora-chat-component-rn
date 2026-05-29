/**
 * Expo config plugin — disable Swift "Explicitly Built Modules" on the
 * app target.
 *
 * Why: Xcode 16+ (here Xcode 26.x) turns on "Explicitly Built Modules"
 * by default in the IDE. During a GUI **Archive** that feature builds
 * Swift/clang modules in a separate ArchiveIntermediates path and fails
 * to locate the CocoaPods-generated module-map files for the Expo
 * pods — producing a wall of:
 *
 *   module map file '...Release-iphoneos/ExpoX/ExpoX.modulemap' not found
 *   Command PrecompileSwiftBridgingHeader emitted errors ...
 *   No such module 'Expo'   (in AppDelegate.swift)
 *
 * A plain `xcodebuild archive` from the CLI does NOT enable the IDE
 * feature, which is why the command line archives fine but Product →
 * Archive in Xcode fails. Forcing `SWIFT_ENABLE_EXPLICIT_MODULES = NO`
 * at the project level overrides the IDE default and makes the GUI
 * archive use the implicit-module path (same as the working CLI build).
 *
 * This lives as a config plugin (not a raw pbxproj edit) so it survives
 * `expo prebuild` — the generated `ios/` folder is gitignored and would
 * otherwise lose the setting on every regen.
 *
 * Safe: implicit modules is the pre-Xcode-16 default; turning the new
 * feature off only costs a little incremental-build caching, not
 * correctness.
 */

const fs = require('fs');
const path = require('path');
const {
  withXcodeProject,
  withDangerousMod,
} = require('@expo/config-plugins');

// (1) Build-setting side: SWIFT_ENABLE_EXPLICIT_MODULES = NO on every
// config (Swift half of the fix).
const withSwiftExplicitModulesOff = (config) =>
  withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const entry = configurations[key];
      if (!entry || typeof entry !== 'object' || !entry.buildSettings) {
        continue;
      }
      entry.buildSettings.SWIFT_ENABLE_EXPLICIT_MODULES = 'NO';
    }
    return cfg;
  });

// (2) Scheme side: serialize the build so the app target's bridging-
// header PCH precompile can't start before the CocoaPods module maps
// exist. Eliminates the archive-time "module map not found" race.
// prebuild regenerates the scheme, so re-apply it on every prebuild.
const withSerializedScheme = (config) =>
  withDangerousMod(config, [
    'ios',
    (cfg) => {
      const projectName =
        cfg.modRequest.projectName || cfg.name || 'ethoraChatComponentRN';
      const schemePath = path.join(
        cfg.modRequest.platformProjectRoot,
        `${projectName}.xcodeproj`,
        'xcshareddata',
        'xcschemes',
        `${projectName}.xcscheme`
      );
      try {
        if (fs.existsSync(schemePath)) {
          let xml = fs.readFileSync(schemePath, 'utf8');
          xml = xml.replace(
            /parallelizeBuildables\s*=\s*"YES"/,
            'parallelizeBuildables = "NO"'
          );
          fs.writeFileSync(schemePath, xml);
        }
      } catch (e) {
        // Non-fatal — the IDE-level default (see README) is the primary
        // lever; this is belt-and-suspenders.
        console.warn('withSerializedScheme: could not patch scheme', e);
      }
      return cfg;
    },
  ]);

const withDisableExplicitModules = (config) =>
  withSerializedScheme(withSwiftExplicitModulesOff(config));

module.exports = withDisableExplicitModules;
