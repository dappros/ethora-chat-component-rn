/**
 * One-level shallow equality for plain objects. Used to avoid re-dispatching
 * config into redux on every render just because the host passed a fresh
 * object literal with the same values (e.g. `<Chat config={{...}} />`
 * re-created inline) — reference equality alone would fire far too often,
 * and a deep/JSON comparison risks throwing on non-serializable fields
 * (functions, React elements) that configs legitimately carry.
 */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) {return true;}
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null
  ) {
    return false;
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {return false;}
  for (const key of aKeys) {
    if (
      (a as Record<string, unknown>)[key] !==
      (b as Record<string, unknown>)[key]
    ) {
      return false;
    }
  }
  return true;
}

export default shallowEqual;
