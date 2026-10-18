import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { lazyModule } from './lazyModule';

export interface LazyComponent<P> {
  /** Render inside a `<Suspense>`. Resolves instantly once `preload()` (or an earlier render) has landed. */
  Component: LazyExoticComponent<ComponentType<P>>;
  /** Start the chunk fetch ahead of the first render. A failed fetch is retried by the next render. */
  preload(): void;
}

/**
 * `React.lazy` plus a preload handle, for UI that only mounts on a user action or a flag
 * (pause / options / results panels, debug overlays): its code stays out of the entry chunk,
 * and `preload()` — called when the thing becomes likely, or at idle — means the first mount
 * finds the module already loaded instead of suspending.
 */
export function lazyComponent<P>(importer: () => Promise<{ default: ComponentType<P> }>): LazyComponent<P> {
  const mod = lazyModule(importer);
  return {
    Component: lazy(() => mod.load()),
    preload() {
      void mod.load().catch(() => {});
    },
  };
}
