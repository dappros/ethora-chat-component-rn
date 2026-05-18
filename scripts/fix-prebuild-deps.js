#!/usr/bin/env node
/**
 * Strip the runtime deps that `expo prebuild` likes to hoist into
 * `dependencies` on first run — for a LIBRARY (which this package is)
 * they belong in `peerDependencies` + `devDependencies`, not the
 * runtime install set. Without this guard, every consumer of
 * `@ethora/chat-component-rn` would end up with a duplicate copy of
 * React / RN / Expo at install time, which crashes at runtime with
 * the classic "two copies of React" reconciler error.
 *
 * Run automatically after `npm run prebuild|ios|android` (any script
 * that triggers expo prebuild). Idempotent: safe to run when there's
 * nothing to fix.
 *
 * Triggered when these names appear under `dependencies`:
 *   - expo
 *   - react
 *   - react-native
 *
 * Implementation note: we do SURGICAL line-based edits on the source
 * file rather than the more obvious JSON.parse → mutate → stringify
 * round-trip. JSON.stringify canonicalises whitespace and would
 * reformat inline-object blocks like `peerDependenciesMeta` from
 * single-line to multi-line, churning unrelated git diff lines on
 * every run. Line-based editing keeps everything outside the
 * `dependencies` block byte-for-byte identical.
 */

const fs = require('node:fs');
const path = require('node:path');

const PKG_PATH = path.resolve(__dirname, '..', 'package.json');
const OFFENDERS = new Set(['expo', 'react', 'react-native']);

function main() {
  const raw = fs.readFileSync(PKG_PATH, 'utf8');
  const lines = raw.split('\n');

  // Find the opening of the top-level `"dependencies": {` block.
  const openIdx = lines.findIndex((l) => /^\s*"dependencies"\s*:\s*\{/.test(l));
  if (openIdx === -1) {return;}

  // Walk forward, tracking brace depth, to find the matching close.
  // The opening line already contains one '{', so start depth = 1.
  let depth = 1;
  let closeIdx = -1;
  for (let i = openIdx + 1; i < lines.length; i++) {
    const opens = (lines[i].match(/\{/g) || []).length;
    const closes = (lines[i].match(/\}/g) || []).length;
    depth += opens - closes;
    if (depth === 0) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {return;}

  // Filter only the lines BETWEEN open and close (exclusive). Drop
  // any line whose key matches an offender.
  const removed = [];
  const kept = [];
  for (let i = openIdx + 1; i < closeIdx; i++) {
    const line = lines[i];
    const m = line.match(/^\s*"([^"]+)"\s*:/);
    if (m && OFFENDERS.has(m[1])) {
      removed.push(m[1]);
      continue;
    }
    kept.push(line);
  }

  if (removed.length === 0) {return;}

  // The last kept dependency line may now carry a trailing comma —
  // that's fine inside the block, but if it's the LAST entry and the
  // close brace is on its own line, the trailing comma is a JSON
  // syntax error. Strip it from the last kept line if present.
  if (kept.length > 0) {
    kept[kept.length - 1] = kept[kept.length - 1].replace(/,(\s*)$/, '$1');
  }

  const next = [
    ...lines.slice(0, openIdx + 1),
    ...kept,
    ...lines.slice(closeIdx),
  ].join('\n');

  fs.writeFileSync(PKG_PATH, next, 'utf8');
  // Sanity: confirm the result still parses.
  JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  console.log(
    `[fix-prebuild-deps] reverted prebuild hoist of: ${removed.join(', ')}`
  );
}

try {
  main();
} catch (err) {
  console.error('[fix-prebuild-deps] failed:', err && err.message);
  // Don't fail the calling script — the prebuild already succeeded;
  // a bad fix-script run is recoverable, exit cleanly.
  process.exit(0);
}
