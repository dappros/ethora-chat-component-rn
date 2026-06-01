export function createTimeoutPromise(
  ms: number | undefined,
  unsubscribe?: () => void
) {
  const promise = new Promise((_, reject) => {
    setTimeout(() => {
      try {
        if (unsubscribe) {
          unsubscribe();
        }
      } catch (e) {}
      // result and stay silent.
      reject();
    }, ms);
  });
 
  promise.catch(() => {});
  return promise;
}
