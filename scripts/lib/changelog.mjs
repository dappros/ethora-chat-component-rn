// CHANGELOG.md helpers for the release. Pure functions on strings, so they are unit tested.
//
// The file follows Keep a Changelog: an `## [Unreleased]` section on top, then one
// `## [<version>]` section per release (a ` - <date>` suffix is optional, the
// version is a date already).

const UNRELEASED = /^## \[?Unreleased\]?[ \t]*$/im;
const ANY_SECTION = /^## /m;

// Index of the line that starts the Unreleased section, or -1.
function findUnreleased(text) {
  const match = UNRELEASED.exec(text);
  return match ? match.index : -1;
}

// The body of the Unreleased section (without its heading), trimmed. '' when empty.
export function unreleasedBody(text) {
  const start = findUnreleased(text);
  if (start < 0) return '';
  const afterHeading = text.indexOf('\n', start) + 1;
  const rest = text.slice(afterHeading);
  const next = rest.search(ANY_SECTION);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

// True when the Unreleased body has at least one list item.
export function hasEntries(text) {
  return /^\s*[-*] \S/m.test(unreleasedBody(text));
}

// Moves the Unreleased body into `## [<version>]` (plus ` - <date>` when a date is
// given) and leaves an empty
// Unreleased section on top. An empty Unreleased gets a single placeholder line, so a
// release that only rebuilds the bundle still has notes.
export function promote(text, version, date) {
  const start = findUnreleased(text);
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  if (new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(text)) {
    throw new Error(`CHANGELOG.md already has a section for ${version}`);
  }
  const body = hasEntries(text) ? unreleasedBody(text) : '- No notable changes.';
  const afterHeading = text.indexOf('\n', start) + 1;
  const rest = text.slice(afterHeading);
  const next = rest.search(ANY_SECTION);
  const tail = next < 0 ? '' : rest.slice(next);
  const head = text.slice(0, start);
  const suffix = date ? ` - ${date}` : '';
  return `${head}## [Unreleased]\n\n## [${version}]${suffix}\n\n${body}\n\n${tail}`.replace(/\n+$/, '\n');
}

// The body of the section for `version`, trimmed. Throws when there is none.
export function notesFor(text, version) {
  const escaped = version.replace(/\./g, '\\.');
  const match = new RegExp(`^## \\[${escaped}\\][^\\n]*$`, 'm').exec(text);
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`);
  const afterHeading = text.indexOf('\n', match.index) + 1;
  const rest = text.slice(afterHeading);
  const next = rest.search(ANY_SECTION);
  const body = (next < 0 ? rest : rest.slice(0, next)).trim();
  if (!body) throw new Error(`The section for ${version} in CHANGELOG.md is empty`);
  return body;
}
