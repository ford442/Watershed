/**
 * The JS heap size where the browser reports it: Chromium's non-standard
 * `performance.memory`. Null elsewhere (Firefox, Safari, workers without it).
 */
type PerformanceWithMemory = Performance & { memory?: { usedJSHeapSize: number } };

export function usedJsHeapBytes(): number | null {
  if (typeof performance === 'undefined') return null;
  const used = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof used === 'number' ? used : null;
}
