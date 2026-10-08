/**
 * MAM query ids. A windowed query (a page around a jump target, a time
 * lookup) is answered through the same wire as the live history, and the
 * global stanza handlers see every `<result>` of it. They tell the two apart
 * by the query id: anything tagged with this prefix belongs to the caller that
 * asked and must never reach the live message list.
 */
export const WINDOW_QUERY_PREFIX = 'window:';

export const isWindowQueryId = (queryId: unknown): boolean =>
  typeof queryId === 'string' && queryId.startsWith(WINDOW_QUERY_PREFIX);
