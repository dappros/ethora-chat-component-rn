export function walletToUsername(string: string) {
  if (string) {
    return (
      string
        .replaceAll(/([A-Z])/g, '_$1')
        .toLowerCase()
        .split('@')?.[0] || ''
    );
  }
  return '';
}
