#!/usr/bin/env node
// CHANGELOG.md command line.
//
//   node scripts/changelog.mjs check              fails when [Unreleased] has no entries
//   node scripts/changelog.mjs promote 26.10.1    moves [Unreleased] into [26.10.1]
//   node scripts/changelog.mjs notes 26.10.1      prints the section of that version (the release notes)
import { readFileSync, writeFileSync } from 'node:fs';
import { hasEntries, notesFor, promote } from './lib/changelog.mjs';

const FILE = 'CHANGELOG.md';
const [command, version] = process.argv.slice(2);

function fail(message) {
  console.error(`changelog: ${message}`);
  process.exit(1);
}

const text = readFileSync(FILE, 'utf8');
try {
  if (command === 'check') {
    if (!hasEntries(text)) fail(`${FILE} has no entries under [Unreleased]`);
    console.log(`changelog: [Unreleased] has entries`);
  } else if (command === 'promote') {
    if (!version) fail('promote needs a version, for example 26.10.1');
    writeFileSync(FILE, promote(text, version));
    console.log(`changelog: [Unreleased] -> [${version}]`);
  } else if (command === 'notes') {
    if (!version) fail('notes needs a version, for example 26.10.1');
    process.stdout.write(`${notesFor(text, version)}\n`);
  } else {
    fail('usage: changelog.mjs check | promote <version> | notes <version>');
  }
} catch (err) {
  fail(err.message);
}
