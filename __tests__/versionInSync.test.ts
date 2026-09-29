/**
 * `src/version.ts` must report the version the package actually ships.
 *
 * It had drifted badly - package.json said 26.6.10 while the constant
 * still said 25.7.5 - because every release commit bumped package.json
 * alone and nothing checked. `npm version` now regenerates the file via
 * scripts/sync-version.mjs; this test is the other half, catching the
 * case where package.json's version is edited by hand and the constant
 * is left behind.
 *
 * If this fails, don't edit src/version.ts: run `node
 * scripts/sync-version.mjs` (or bump with `npm version`).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { ETHORA_CHAT_COMPONENT_VERSION } from '../src/version';

describe('shipped version constant', () => {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
  ) as { version: string; scripts?: Record<string, string> };

  it('matches package.json', () => {
    expect(ETHORA_CHAT_COMPONENT_VERSION).toBe(pkg.version);
  });

  it('looks like a semver release', () => {
    expect(ETHORA_CHAT_COMPONENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('stays wired to npm version, so a bump keeps them together', () => {
    // Without this hook the constant only stays correct by luck - which
    // is exactly how it fell four minor versions behind.
    expect(pkg.scripts?.version).toBe('node scripts/sync-version.mjs');
  });
});
