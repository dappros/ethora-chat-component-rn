#!/usr/bin/env node
// Checks what `npm publish` would put in the package, without publishing: runs
// `npm pack --dry-run` and verifies the list of files. Needs a built lib/ (npm run build;
// `npm pack` without --dry-run builds it through the prepack script).
//
//   node scripts/check-package.mjs
//
// Every file that package.json points consumers at (main, module, types, react-native,
// exports) must be in the package, the Expo config plugin files must be there, and
// nothing that looks like a test, a native project, a key or a local credential file may be.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// --ignore-scripts: prepack would rebuild lib/, and the prepare script prints to stdout.
const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error(result.stderr);
  console.error('check-package: npm pack --dry-run failed');
  process.exit(1);
}

let pack;
try {
  [pack] = JSON.parse(result.stdout);
} catch (err) {
  console.error(`check-package: cannot read the npm pack output: ${err.message}`);
  process.exit(1);
}
const files = new Set(pack.files.map((file) => file.path));

// Every string under exports (any depth) plus the classic entry fields.
const referenced = new Set();
const collect = (value) => {
  if (typeof value === 'string') referenced.add(value.replace(/^\.\//, ''));
  else if (value && typeof value === 'object') Object.values(value).forEach(collect);
};
collect(pkg.exports);
for (const field of ['main', 'module', 'react-native', 'types']) {
  if (typeof pkg[field] === 'string') referenced.add(pkg[field].replace(/^\.\//, ''));
}

const REQUIRED = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'app.plugin.js',
  'metro.js',
  'empty-shim.js',
  'plugins/withNotificationServiceExtension.js',
];
const FORBIDDEN = [
  /^__tests__\//,
  /^e2e\//,
  /^ios\//,
  /^android\//,
  /^node_modules\//,
  /(^|\/)\.env/,
  /(^|\/)api\.config\.local/,
  /seed-jwt-creds\.local/,
  /\.keystore$/,
  /\.(pem|p12|jks)$/,
];

const problems = [];
for (const file of [...referenced, ...REQUIRED]) {
  if (!files.has(file)) problems.push(`missing from the package: ${file}`);
}
for (const file of files) {
  if (FORBIDDEN.some((re) => re.test(file))) problems.push(`must not be in the package: ${file}`);
}
if (![...files].some((file) => file.startsWith('lib/'))) problems.push('lib/ is empty, run "npm run build" first');

console.log(`${pack.name}@${pack.version}: ${files.size} files, ${(pack.unpackedSize / 1048576).toFixed(1)} MB unpacked`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`error: ${problem}`);
  process.exit(1);
}
console.log('check-package: ok');
