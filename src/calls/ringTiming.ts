export const CALL_RING_WINDOW_MS = 60_000;
const CALL_CONNECT_BUFFER_MS = 5_000;

// Let the server publish missed calls first. This fallback only closes the
// local dial UI if the terminal stanza never arrives (e.g. socket offline).
export const OUTGOING_RING_FALLBACK_MS = CALL_RING_WINDOW_MS + CALL_CONNECT_BUFFER_MS;

export const incomingCallDeadline = (
  receivedAt: number,
  serverExpiresAt?: unknown,
  tokenExpirySeconds?: unknown
): number => {
  const serverExpiry = Number(serverExpiresAt);
  const tokenExpiry = Number(tokenExpirySeconds) * 1000;
  return Math.min(
    receivedAt + CALL_RING_WINDOW_MS,
    Number.isFinite(serverExpiry) && serverExpiry > 0 ? serverExpiry : Infinity,
    Number.isFinite(tokenExpiry) && tokenExpiry > 0 ? tokenExpiry : Infinity
  ) - CALL_CONNECT_BUFFER_MS;
};
