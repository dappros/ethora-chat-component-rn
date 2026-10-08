export const composeName = (
  first?: string | null,
  last?: string | null
): string => {
  const f = String(first ?? '').trim();
  const l = String(last ?? '').trim();
  if (f && f.includes('@') && f.toLowerCase() === l.toLowerCase()) {return f;}
  return `${f} ${l}`.trim();
};
