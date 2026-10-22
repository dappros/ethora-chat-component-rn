// Unit checks for scripts/lib/changelog.mjs. Run with: npm run test:release
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasEntries, notesFor, promote, unreleasedBody } from './changelog.mjs';

const sample = `# Changelog

Intro text.

## [Unreleased]

### Added

- New thing.

### Fixed

- Old bug.

## [26.7.2] - 2026-09-09

- Earlier release.
`;

test('reads the Unreleased body', () => {
  assert.match(unreleasedBody(sample), /^### Added/);
  assert.doesNotMatch(unreleasedBody(sample), /Earlier release/);
  assert.equal(hasEntries(sample), true);
});

test('an Unreleased section with only headings has no entries', () => {
  assert.equal(hasEntries('## [Unreleased]\n\n### Added\n\n## [1.0.0] - 2026-01-01\n\n- x\n'), false);
});

test('promote moves the body under the version and keeps an empty Unreleased', () => {
  const out = promote(sample, '26.10.1', '2026-10-21');
  assert.match(out, /## \[Unreleased\]\n\n## \[26\.10\.1\] - 2026-10-21\n\n### Added\n\n- New thing\./);
  assert.equal(unreleasedBody(out), '');
  assert.match(out, /## \[26\.7\.2\] - 2026-09-09/);
  assert.ok(out.endsWith('- Earlier release.\n'));
  assert.equal(notesFor(out, '26.10.1').includes('Old bug'), true);
  assert.equal(notesFor(out, '26.10.1').includes('Earlier release'), false);
});

test('promote without a date writes a bare version heading', () => {
  const out = promote(sample, '26.10.1');
  assert.match(out, /## \[26\.10\.1\]\n\n### Added/);
  assert.equal(notesFor(out, '26.10.1').includes('Old bug'), true);
});

test('promote of an empty Unreleased writes a placeholder line', () => {
  const out = promote('## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- x\n', '1.0.1', '2026-02-02');
  assert.match(notesFor(out, '1.0.1'), /No notable changes/);
});

test('promote refuses a version that already has a section, or a file without Unreleased', () => {
  assert.throws(() => promote(sample, '26.7.2', '2026-10-21'), /already has a section/);
  assert.throws(() => promote('# Changelog\n', '1.0.0', '2026-10-21'), /no "## \[Unreleased\]"/);
});

test('promote works when Unreleased is the only section', () => {
  const out = promote('# Changelog\n\n## [Unreleased]\n\n- Only.\n', '1.0.0', '2026-01-01');
  assert.equal(notesFor(out, '1.0.0'), '- Only.');
});

test('notesFor throws for a missing or empty section', () => {
  assert.throws(() => notesFor(sample, '26.1.1'), /no section/);
  assert.throws(() => notesFor('## [1.0.0] - 2026-01-01\n\n## [0.9.0] - 2025-01-01\n\n- x\n', '1.0.0'), /empty/);
});
