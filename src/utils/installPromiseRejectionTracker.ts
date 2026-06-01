/**
 * Dev-only unhandled-promise-rejection tracker.
 *
 * RN's red-screen for `Uncaught (in promise, id: N)` famously hides the
 * actual rejection's stack trace — it only shows the promise id. When a
 * leak slips past the SDK's coverage, the integrator gets a useless
 * red box that they can't diagnose.
 *
 * This installer attaches a global `unhandledrejection` listener that
 * prints the rejection value AND a stack trace (best-effort) so the
 * source is visible in Metro logs. It's a no-op in production builds.
 *
 * Installed automatically from `ReduxWrapper` on mount. Safe to call
 * multiple times — guarded by a module-level flag.
 *
 * Bug #4 follow-up.
 */

declare const __DEV__: boolean | undefined;

let installed = false;

export function installPromiseRejectionTracker() {
  if (typeof __DEV__ !== 'undefined' && !__DEV__) {return;}
  if (installed) {return;}
  installed = true;

  // RN's RCTPromise polyfill emits `unhandledrejection` on the global
  // (HermesInternal / global). It also forwards through the
  // `process.on('unhandledRejection', ...)` shim on some builds.
  const g: any = globalThis as any;

  const onRejection = (eventOrReason: any, maybePromise?: Promise<any>) => {
    // Two calling conventions across RN versions:
    //   - `(event)` where event has `.reason` / `.promise`
    //   - `(reason, promise)` (older)
    const reason = eventOrReason?.reason ?? eventOrReason;
    const promise = eventOrReason?.promise ?? maybePromise;
    const stack =
      (reason && reason.stack) ||
      new Error('unhandledrejection (captured at handler)').stack;
    // console.WARN (not error): RN's LogBox turns every console.error into
    // a full-screen red overlay. With `allRejections: true` Hermes reports
    // rejections that get handled a microtask later (false positives, e.g.
    // a bare `undefined` rejection during connect teardown), so escalating
    // to a red box was pure noise. warn keeps the trace in Metro/Logs.
    // eslint-disable-next-line no-console
    console.warn(
      '[ethora-rn] UNHANDLED PROMISE REJECTION:',
      typeof reason === 'object' ? JSON.stringify(reason, null, 2) : String(reason),
      '\nstack:',
      stack,
      '\npromise:',
      promise
    );
  };

  try {
    if (typeof g.addEventListener === 'function') {
      g.addEventListener('unhandledrejection', onRejection);
    }
  } catch {}
  try {
    if (g.process && typeof g.process.on === 'function') {
      g.process.on('unhandledRejection', onRejection);
    }
  } catch {}
  try {
    // Hermes-only hook — newer RN exposes this.
    if (typeof g.HermesInternal?.enablePromiseRejectionTracker === 'function') {
      g.HermesInternal.enablePromiseRejectionTracker({
        allRejections: false,
        onUnhandled: (id: number, error: any) => {
          // warn, not error — see note above. `allRejections: true` fires
          // this for rejections handled a tick later, so a red box here
          // was a false alarm. Stays visible in Metro/Logs as a warning.
          // eslint-disable-next-line no-console
          console.warn(
            `[ethora-rn] Hermes unhandled rejection id=${id}:`,
            error?.message ?? error,
            '\nstack:',
            error?.stack
          );
        },
        onHandled: () => {},
      });
    }
  } catch {}
}

export default installPromiseRejectionTracker;
