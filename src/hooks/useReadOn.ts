import { useRef } from 'react';

/**
 * A value read from outside React — a ref'd manager, a module-level store, saved
 * progress — re-read only when `key` changes (#554 E).
 *
 * The source publishes no change of its own, so the caller names the signal that
 * means "it may have changed": the pool version a treadmill bumps after it mutates,
 * the run's map, a journey flip. That is the shape `useMemo(read, [version])` was
 * used for, where the linter rightly reports `version` as a dependency the callback
 * never reads. Here the key is explicit, compared element-wise with `Object.is`, and
 * `read` runs during render exactly as the memo's callback did.
 */
export function useReadOn<T>(read: () => T, key: readonly unknown[]): T {
  const cache = useRef<{ key: readonly unknown[]; value: T } | null>(null);
  const hit = cache.current;
  if (hit && sameKey(hit.key, key)) return hit.value;
  const value = read();
  cache.current = { key, value };
  return value;
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}
