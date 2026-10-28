/**
 * queryFlags.ts — the one reader of the page's query string (#521 E).
 *
 * Everything that looks at `?…` goes through here; ESLint bans
 * `location.search` everywhere else. Two shapes:
 *
 *   - `queryFlags()` — the typed flags, a frozen object. Parsed once per
 *     distinct query string, so in a running game (whose URL does not change)
 *     it is parsed once at boot and every later call, per-frame callers
 *     included, is a string compare and the same object back.
 *   - `queryParam(name)` / `queryParams()` — the raw parameters, for parsers
 *     with their own grammar (`?input=script:…`, `?weather=`, …). Those take an
 *     explicit `search` string in their tests; their default is `currentSearch()`.
 *
 * A few dev toggles write the URL (`?physicsDebug`, `?wireframe`, `?cleanTest`,
 * `?debugStages`) so a reload keeps them: they use `editQuery`, and the next
 * read sees the new string.
 *
 * Boolean flags accept `1` or `true` (so `?debug=1` and `?debug=true` are the
 * same switch); a bare presence flag (`?no-pointer-lock`) is on when present
 * with any value but `0` / `false`.
 */

export interface QueryFlags {
  /** `?debug=1|true` — debug hotkeys, the inspector, the F3 readout at boot, collider draw. */
  readonly debug: boolean;
  /** `?map=<id>` (validated by the campaign / registry). */
  readonly map: string | null;
  /** `?vehicle=runner|raft`. */
  readonly vehicle: string | null;
  /** `?material=glsl|tsl`. */
  readonly material: string | null;
  /** `?renderer=webgl|webgpu|auto`. */
  readonly renderer: string | null;
  /** `?input=touch|script:<url>`. */
  readonly input: string | null;
  /** `?replay=<ghost url>`. */
  readonly replay: string | null;
  /** `?simWorker=0|1`. */
  readonly simWorker: string | null;
  /** `?no-pointer-lock` — harness: never lock the pointer, skip the loader. */
  readonly noPointerLock: boolean;
  /** `?screenshot=1` — harness capture. */
  readonly screenshot: boolean;
  /** `?physicsDebug=1|true` — Rapier collider draw from boot. */
  readonly physicsDebug: boolean;
  /** `?wireframe=1|true`. */
  readonly wireframe: boolean;
  /** `?editor=1` (dev builds only open the editor). */
  readonly editor: boolean;
  /** `?wasmWaterTest=1` — the WASM water-force test scene. */
  readonly wasmWaterTest: boolean;
  /** `?river=<id>` — run a saved user river. */
  readonly river: string | null;
  /** `?seed=<n>`. */
  readonly seed: string | null;
  /** `?spawnProfile=1` — segment-mount timing marks. */
  readonly spawnProfile: boolean;
}

/** `1` / `true` (case-sensitive, as every flag has always been). */
export function isOnValue(raw: string | null | undefined): boolean {
  return raw === '1' || raw === 'true';
}

function presence(params: URLSearchParams, name: string): boolean {
  if (!params.has(name)) return false;
  const raw = params.get(name);
  return raw !== '0' && raw !== 'false';
}

/** The page's query string as it is now (`''` off the main thread's window, e.g. tests in node). */
export function currentSearch(): string {
  if (typeof location === 'undefined') return '';
  return location.search ?? '';
}

let cachedSearch: string | null = null;
let cachedParams = new URLSearchParams();
let cachedFlags: QueryFlags | null = null;

function normalise(search: string): string {
  return search.startsWith('?') ? search.slice(1) : search;
}

/** Parameters of `search` (default: the page's). Treat as read-only. */
export function queryParams(search: string = currentSearch()): URLSearchParams {
  const key = normalise(search);
  if (key !== cachedSearch) {
    cachedSearch = key;
    cachedParams = new URLSearchParams(key);
    cachedFlags = null;
  }
  return cachedParams;
}

/** One raw parameter of `search` (default: the page's). */
export function queryParam(name: string, search?: string): string | null {
  return queryParams(search).get(name);
}

/** Pure: the flags of a query string (with or without the leading `?`). */
export function parseQueryFlags(search: string): QueryFlags {
  const p = new URLSearchParams(normalise(search));
  return Object.freeze({
    debug: isOnValue(p.get('debug')),
    map: p.get('map'),
    vehicle: p.get('vehicle'),
    material: p.get('material'),
    renderer: p.get('renderer'),
    input: p.get('input'),
    replay: p.get('replay'),
    simWorker: p.get('simWorker'),
    noPointerLock: presence(p, 'no-pointer-lock'),
    screenshot: p.get('screenshot') === '1',
    physicsDebug: isOnValue(p.get('physicsDebug')),
    wireframe: isOnValue(p.get('wireframe')),
    editor: p.get('editor') === '1',
    wasmWaterTest: p.get('wasmWaterTest') === '1',
    river: p.get('river'),
    seed: p.get('seed'),
    spawnProfile: p.get('spawnProfile') === '1',
  });
}

/** The page's flags: the same frozen object until the query string changes. */
export function queryFlags(): QueryFlags {
  queryParams();
  if (!cachedFlags) cachedFlags = parseQueryFlags(cachedSearch ?? '');
  return cachedFlags;
}

/**
 * Rewrite the page's query string in place (no navigation, no history entry):
 * `edit` mutates a copy of the current parameters. For dev toggles that should
 * survive a reload.
 */
export function editQuery(edit: (params: URLSearchParams) => void): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(normalise(currentSearch()));
  edit(params);
  const next = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`);
}
