export const nanoToMs = (number: string): number | null => {
  return +number.slice(0, 13) || null;
};
