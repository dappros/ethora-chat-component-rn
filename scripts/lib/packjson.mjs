// `npm pack --json` prints a JSON array, but some npm versions print lifecycle output
// (patch-package from the prepare script) before it even with --ignore-scripts.
// This cuts the array out of stdout: it starts on a line that is only "[".
export function jsonArrayFrom(stdout) {
  const start = /^\[\s*$/m.exec(stdout);
  return JSON.parse(start ? stdout.slice(start.index) : stdout);
}
