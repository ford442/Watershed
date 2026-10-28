/**
 * queryFlags.ts — every URL flag the game reads at boot, parsed once (#521 E).
 *
 * `queryFlags` is a frozen snapshot of `location.search` taken when this module
 * first loads (the page's boot): the same answer on every read for the life of
 * the page, so a flag can be read from a frame path or a module constant
 * without re-parsing the query string — and `?debug=1` and `?debug=true` are one
 * flag, parsed here and nowhere else.
 *
 * This is the one module that touches `location.search` for a flag it owns
 * (ESLint bans `location.search` everywhere else; the per-flag helpers that
 * still take an explicit `search` are on the allowlist in eslint.config.js and
 * move here as they are next touched).
 *
 * Values are the raw strings (null = absent): resolving them — which map, which
 * material backend — stays with their owners (`resolveMaterialBackend`, the map
 * registry, …), which read `queryFlags.material` / `.map` instead of the URL.
 */

export interface QueryFlags {
  /** The raw query string this was parsed from ('' or with its leading '?'). */
  readonly search: string;
  /** `?debug=1` or `?debug=true` — the one switch for debug hotkeys, the inspector, collider draw. */
  readonly debug: boolean;
  /** `?no-pointer-lock` (anywhere in the query): headless harnesses that cannot lock the pointer. */
  readonly noPointerLock: boolean;
  /** `?screenshot=1`: the capture harness's teleport / clean-frame mode. */
  readonly screenshot: boolean;
  /** `?safe=1|true`: ask for the safe-graphics path. Parsed for the boot guard; nothing reads it yet. */
  readonly safe: boolean;
  /** `?map=<id>` */
  readonly map: string | null;
  /** `?vehicle=runner|raft` */
  readonly vehicle: string | null;
  /** `?material=glsl|tsl` */
  readonly material: string | null;
  /** `?renderer=webgl|webgpu` */
  readonly renderer: string | null;
  /** `?input=touch|script:<url>` */
  readonly input: string | null;
  /** `?replay=<ghost url>` */
  readonly replay: string | null;
  /** `?simWorker=0` and friends */
  readonly simWorker: string | null;
  /** `?river=<id>` (a player's river) */
  readonly river: string | null;
  /** `?level=<file>` (a level under ./levels) */
  readonly level: string | null;
  /** `?levelUrl=<url>` */
  readonly levelUrl: string | null;
  /** `?reach=<id>` */
  readonly reach: string | null;
  /** `?reachId=<id>` (the id ReachManager streams) */
  readonly reachId: string | null;
  /** `?seed=<n>` */
  readonly seed: string | null;
}

/** `1` or `true` — how every boolean flag in this game is spelled. */
export function isTruthyFlag(raw: string | null | undefined): boolean {
  return raw === '1' || raw === 'true';
}

/** Parse a query string (with or without the leading '?') into the flag object. Pure. */
export function parseQueryFlags(search: string): QueryFlags {
  const params = new URLSearchParams(search);
  const text = (key: string): string | null => params.get(key);
  return Object.freeze({
    search,
    debug: isTruthyFlag(params.get('debug')),
    noPointerLock: search.includes('no-pointer-lock'),
    screenshot: params.get('screenshot') === '1',
    safe: isTruthyFlag(params.get('safe')),
    map: text('map'),
    vehicle: text('vehicle'),
    material: text('material'),
    renderer: text('renderer'),
    input: text('input'),
    replay: text('replay'),
    simWorker: text('simWorker'),
    river: text('river'),
    level: text('level'),
    levelUrl: text('levelUrl'),
    reach: text('reach'),
    reachId: text('reachId'),
    seed: text('seed'),
  });
}

/** The page's flags, parsed once when this module loads. */
export const queryFlags: QueryFlags = parseQueryFlags(
  typeof window !== 'undefined' ? window.location.search : '',
);
