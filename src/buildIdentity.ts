/** Session build identity: short git SHA + WASM artifact stamp + ISO build time.
 *  Injected by vite.config.ts via `define`. Do not compute it here — the same
 *  string is stamped into index.html and written to build/BUILD_ID. */
declare const __WATERSHED_BUILD_IDENTITY__: string;

export const BUILD_IDENTITY: string = __WATERSHED_BUILD_IDENTITY__;

/** String literal kept in the entry chunk so `verify_deploy.mjs` can grep a
 *  minified production bundle (the function name itself is mangled). */
export const GRAPHICS_BOOT_TOKEN = 'negotiateBootGraphics';
