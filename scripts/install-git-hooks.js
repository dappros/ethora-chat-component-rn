#!/usr/bin/env node
/**
 * Wires git to use the versioned `.githooks/` directory by setting
 * `core.hooksPath`. Runs from `npm install` via the `prepare` script.
 *
 * Why this script (not husky/simple-git-hooks): zero runtime deps and
 * the hook scripts are plain shell files versioned in `.githooks/`,
 * so the contract is auditable on a single `cat`. The script no-ops
 * when not in a git working tree (e.g. when consumers npm-install
 * this package as a dependency from a non-git source).
 */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

try {
  // Only act inside a git working tree.
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
} catch {
  // Not in a git repo — e.g. installed as a dependency. Silent exit.
  process.exit(0);
}

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim();
const here = path.resolve(__dirname, '..');
// Guard: if this script lives outside the git workdir (very unusual,
// like a globally-installed dep), do nothing.
if (path.resolve(repoRoot) !== path.resolve(here)) {
  process.exit(0);
}

const hooksDir = path.join(repoRoot, '.githooks');
if (!fs.existsSync(hooksDir)) {
  console.warn(
    `install-git-hooks: ${hooksDir} not present — skipping core.hooksPath wiring`
  );
  process.exit(0);
}

try {
  execSync('git config core.hooksPath .githooks', { cwd: repoRoot, stdio: 'ignore' });
  console.log('install-git-hooks: core.hooksPath → .githooks');
} catch (err) {
  console.warn('install-git-hooks: failed to set core.hooksPath:', err?.message || err);
}
