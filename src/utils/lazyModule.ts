/**
 * lazyModule — a dynamic `import()` with a synchronous accessor.
 *
 * For code that is needed only by some presets / GPUs / manifests, so it stays out of the
 * entry chunk, but whose call site is synchronous (a render loop, a constructor): `load()`
 * starts (or joins) the fetch, `get()` is null until it has resolved. A failed fetch is
 * forgotten so the next `load()` retries instead of replaying the rejection.
 */
export interface LazyModule<T> {
  /** Start (or join) the import. Safe to call every frame. */
  load(): Promise<T>;
  /** The module once `load()` has resolved, else null. */
  get(): T | null;
  /** Test seam — drops the cache so a test can assert the not-yet-loaded path. */
  reset(): void;
}

export function lazyModule<T>(importer: () => Promise<T>): LazyModule<T> {
  let cached: T | null = null;
  let pending: Promise<T> | null = null;
  return {
    load() {
      if (cached) return Promise.resolve(cached);
      pending ??= importer().then(
        (mod) => {
          cached = mod;
          pending = null;
          return mod;
        },
        (err: unknown) => {
          pending = null;
          throw err;
        },
      );
      return pending;
    },
    get: () => cached,
    reset() {
      cached = null;
      pending = null;
    },
  };
}
