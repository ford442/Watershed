/**
 * Public asset base URL for loading files from `public/`.
 *
 * Vite replaces `__WATERSHED_ASSET_BASE__` at build time (see vite.config.ts).
 * Vitest inherits the Vite define; tests fall back to `/` when absent.
 */
declare const __WATERSHED_ASSET_BASE__: string | undefined;

export function getAssetBaseUrl(): string {
  if (typeof __WATERSHED_ASSET_BASE__ === 'string' && __WATERSHED_ASSET_BASE__.length > 0) {
    return __WATERSHED_ASSET_BASE__;
  }
  return '/';
}
