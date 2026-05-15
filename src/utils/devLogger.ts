/**
 * Dev-only log bus used by the testbed `Logs` tab. Stores a bounded
 * ring-buffer of entries that arrive from:
 *   - `console.log/info/warn/error` (patched in `installDevLogCapture`)
 *   - `axios` request/response interceptors (HTTP)
 *   - `XmppClient.attachEventListeners` (XMPP stanzas in/out)
 *
 * Pure module-level singleton — no React, callable from anywhere
 * (reducers, services, helpers). React side reads via
 * `useDevLogs()` which uses `useSyncExternalStore`.
 */

export type LogKind = 'log' | 'info' | 'warn' | 'error' | 'http' | 'xmpp' | 'rn';

export interface LogEntry {
  id: number;
  kind: LogKind;
  ts: number;
  message: string;
  details?: string;
}

const MAX_ENTRIES = 500;

let entries: LogEntry[] = [];
let listeners: Set<() => void> = new Set();
let nextId = 1;

function snapshot(): LogEntry[] {
  return entries;
}

export function pushLog(
  kind: LogKind,
  message: string,
  details?: any
): void {
  const detailsStr =
    details === undefined
      ? undefined
      : typeof details === 'string'
        ? details
        : safeStringify(details);
  entries = [
    ...entries,
    { id: nextId++, kind, ts: Date.now(), message, details: detailsStr },
  ];
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  // Defer subscriber notifications via microtask so a `pushLog` called
  // during a React render (e.g. via the captured `console.log`) doesn't
  // trigger a setState-during-render warning in subscribers using
  // `useSyncExternalStore`.
  const notify = () =>
    listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        /* noop */
      }
    });
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(notify);
  } else {
    Promise.resolve().then(notify);
  }
}

export function clearLogs(): void {
  entries = [];
  listeners.forEach((fn) => fn());
}

export function getLogs(): LogEntry[] {
  return entries;
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function safeStringify(value: any): string {
  try {
    return JSON.stringify(
      value,
      (_key, v) => {
        if (typeof v === 'bigint') return v.toString();
        if (v instanceof Error)
          return { name: v.name, message: v.message, stack: v.stack };
        return v;
      },
      2
    );
  } catch {
    try {
      return String(value);
    } catch {
      return '[unstringifiable]';
    }
  }
}

// ---------------------------------------------------------------------
// console.* capture
// ---------------------------------------------------------------------
let consolePatched = false;

export function installConsoleCapture() {
  if (consolePatched) return;
  consolePatched = true;
  (['log', 'info', 'warn', 'error'] as const).forEach((level) => {
    const original = (console as any)[level].bind(console);
    (console as any)[level] = (...args: any[]) => {
      try {
        const msg = args
          .map((a) =>
            typeof a === 'string' ? a : safeStringify(a)
          )
          .join(' ');
        pushLog(level === 'log' ? 'log' : (level as LogKind), msg);
      } catch {
        /* swallow */
      }
      original(...args);
    };
  });
}

// ---------------------------------------------------------------------
// axios interceptor
// ---------------------------------------------------------------------
let axiosPatched = false;

export function installAxiosCapture(axiosInstance: any) {
  if (axiosPatched || !axiosInstance?.interceptors) return;
  axiosPatched = true;

  axiosInstance.interceptors.request.use(
    (config: any) => {
      const method = (config.method || 'get').toUpperCase();
      const url = (config.baseURL || '') + (config.url || '');
      pushLog('http', `→ ${method} ${url}`, {
        headers: redactHeaders(config.headers),
        data: config.data,
      });
      return config;
    },
    (error: any) => {
      pushLog('http', '→ request error', error?.message || String(error));
      return Promise.reject(error);
    }
  );

  axiosInstance.interceptors.response.use(
    (response: any) => {
      const method = (response.config?.method || 'get').toUpperCase();
      const url = (response.config?.baseURL || '') + (response.config?.url || '');
      pushLog(
        'http',
        `← ${response.status} ${method} ${url}`,
        truncateBody(response.data)
      );
      return response;
    },
    (error: any) => {
      const method = (error.config?.method || '?').toUpperCase();
      const url = (error.config?.baseURL || '') + (error.config?.url || '');
      const status = error.response?.status || 'no-status';
      pushLog('http', `← ERR ${status} ${method} ${url}`, {
        data: error.response?.data,
        message: error.message,
      });
      return Promise.reject(error);
    }
  );
}

function redactHeaders(headers: any) {
  if (!headers || typeof headers !== 'object') return headers;
  const out: any = {};
  for (const k of Object.keys(headers)) {
    const v = headers[k];
    if (/^(authorization|x-custom-token|cookie)$/i.test(k)) {
      out[k] = typeof v === 'string' ? v.slice(0, 16) + '…' : '[redacted]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

function truncateBody(body: any) {
  if (body == null) return body;
  const str = typeof body === 'string' ? body : safeStringify(body);
  if (str.length <= 2000) return str;
  return str.slice(0, 2000) + `… [+${str.length - 2000} chars]`;
}
