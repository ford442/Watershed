/** Run `fn` when the main thread is idle (250 ms timer where `requestIdleCallback` is missing).
 *  Returns a cancel function. */
export function whenIdle(fn: () => void, timeoutMs = 3000): () => void {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(fn, { timeout: timeoutMs });
    return () => g.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(fn, 250);
  return () => clearTimeout(handle);
}
