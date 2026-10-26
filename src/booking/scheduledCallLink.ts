import { store } from '../roomStore';

/**
 * Deep links for scheduled calls.
 *
 *   https://<host>/call/<slug>      universal / app link, <host> must be a known host
 *   <scheme>://call/<slug>          the app's own URL scheme
 *
 * The slug is the secret in the link; this only extracts it. Whether the
 * signed-in user may see the call is the server's answer to
 * `GET /v1/chats/calls/scheduled/:slug`.
 *
 * Known hosts and schemes come from `config.scheduledCalls` and from
 * `configureScheduledCallLinks()`, which a host calls at startup so a link
 * that opens the app before `<Chat>` is mounted can already be recognised.
 */

/** The hosted web app: always accepted. */
export const DEFAULT_SCHEDULED_CALL_HOSTS = ['app.chat.ethora.com'];

export interface ScheduledCallLinkOptions {
  /** Hosts whose `https://<host>/call/<slug>` links open the app. */
  hosts?: string[];
  /** Custom URL schemes, without `://` (e.g. `ethorachat`). */
  schemes?: string[];
}

let configured: Required<ScheduledCallLinkOptions> = { hosts: [], schemes: [] };

const clean = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/:\/\/.*$/, '')
    .replace(/:$/, '');

const cleanHost = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');

/** Replaces the host list and schemes set by a previous call. */
export const configureScheduledCallLinks = (
  options: ScheduledCallLinkOptions
): void => {
  configured = {
    hosts: (options.hosts || []).map(cleanHost).filter(Boolean),
    schemes: (options.schemes || []).map(clean).filter(Boolean),
  };
};

export const __resetScheduledCallLinksForTests = (): void => {
  configured = { hosts: [], schemes: [] };
};

const fromStore = (): ScheduledCallLinkOptions => {
  try {
    return store.getState().chatSettingStore?.config?.scheduledCalls || {};
  } catch {
    return {};
  }
};

/** Every host and scheme in force right now. */
export const getScheduledCallLinkTargets = (): Required<ScheduledCallLinkOptions> => {
  const fromConfig = fromStore();
  const hosts = new Set<string>([
    ...DEFAULT_SCHEDULED_CALL_HOSTS,
    ...configured.hosts,
    ...(fromConfig.hosts || []).map(cleanHost),
  ]);
  const schemes = new Set<string>([
    ...configured.schemes,
    ...(fromConfig.schemes || []).map(clean),
  ]);
  hosts.delete('');
  schemes.delete('');
  return { hosts: [...hosts], schemes: [...schemes] };
};

// 22+ url-safe characters per the contract; accept a little shorter so a
// backend that trims its encoding does not break every link.
const SLUG = /^[A-Za-z0-9_-]{16,128}$/;
const URL_SHAPE = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?[^#]*)?(?:#.*)?$/i;
const NEVER_SCHEMES = new Set(['javascript', 'data', 'file', 'blob', 'about', 'vbscript']);

const slugFromPath = (path: string, prefix: '/call/' | '/'): string | null => {
  if (!path.startsWith(prefix)) {return null;}
  const rest = path.slice(prefix.length).replace(/\/+$/, '');
  if (rest.includes('/')) {return null;}
  let slug = rest;
  try {
    slug = decodeURIComponent(rest);
  } catch {
    return null;
  }
  return SLUG.test(slug) ? slug : null;
};

/**
 * The slug of a scheduled-call link, or null when the URL is anything else.
 *
 * `https://app.chat.ethora.com/call/<slug>` (and any other configured host)
 * and `<scheme>://call/<slug>` qualify. With no scheme configured any custom
 * scheme is accepted (only `http(s)` and a few script-like ones never are);
 * once schemes are configured only those are.
 */
export const parseScheduledCallLink = (
  url: string | null | undefined,
  options?: ScheduledCallLinkOptions
): string | null => {
  if (typeof url !== 'string') {return null;}
  const match = URL_SHAPE.exec(url.trim());
  if (!match) {return null;}
  const scheme = match[1].toLowerCase();
  const authority = match[2];
  const path = match[3] || '';

  const targets = getScheduledCallLinkTargets();
  const hosts = options?.hosts?.length
    ? options.hosts.map(cleanHost)
    : targets.hosts;
  const schemes = options?.schemes?.length
    ? options.schemes.map(clean)
    : targets.schemes;

  if (scheme === 'https' || scheme === 'http') {
    // Universal links are https only; a plain http link is never trusted.
    if (scheme !== 'https') {return null;}
    if (authority.includes('@')) {return null;}
    const host = cleanHost(authority);
    if (!host || !hosts.includes(host)) {return null;}
    return slugFromPath(path, '/call/');
  }

  if (NEVER_SCHEMES.has(scheme)) {return null;}
  if (schemes.length > 0 && !schemes.includes(scheme)) {return null;}
  // <scheme>://call/<slug>; some launchers hand over <scheme>:///call/<slug>.
  if (authority.toLowerCase() === 'call') {return slugFromPath(path, '/');}
  if (authority === '') {return slugFromPath(path, '/call/');}
  return null;
};
