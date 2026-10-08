export function parseSealedMediaBody(body?: string): string[] | undefined {
  const text = String(body || '').trim();
  if (!text.startsWith('{')) {return undefined;}

  try {
    const parsed = JSON.parse(text) as { v?: unknown; keys?: unknown };
    if (parsed?.v !== 1 || !Array.isArray(parsed.keys)) {return undefined;}
    const keys = parsed.keys.filter(
      (k): k is string => typeof k === 'string' && k.length > 0
    );
    return keys.length === parsed.keys.length && keys.length > 0
      ? keys
      : undefined;
  } catch {
    return undefined;
  }
}
