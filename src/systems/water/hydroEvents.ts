/**
 * hydroEvents — authored source terms on the SWE grid (#389 / #391).
 *
 * Maps declare `hydroEvents[]`. At the run's launch hour, active events
 * write mass / momentum / bed into the same `(η,u,w,b)` field the mesh and
 * Rapier already sample. This is not a sixth decoration type.
 */

export const HYDRO_EVENT_KINDS = ['inflowPulse', 'vortex', 'braid', 'roughness', 'surge'] as const;
export type HydroEventKind = (typeof HYDRO_EVENT_KINDS)[number];

/** Packed kind ids matching `applySWEEvent` in emscripten/swe.cpp. */
export const HYDRO_KIND_INFLOW = 0;
export const HYDRO_KIND_VORTEX = 1;
export const HYDRO_KIND_BRAID = 2;
export const HYDRO_KIND_ROUGHNESS = 3;
export const HYDRO_KIND_SURGE = 4;

/**
 * Kernel tuning shared with `applySWEEvent` in emscripten/swe.cpp (#397).
 *
 * These are the numbers that make an authored hour *playable* rather than
 * merely present in the field:
 *
 *  - INFLOW_DOWNSTREAM — a dam pulse is mass *and* momentum. Without it the
 *    stage rises but the hull never rides faster.
 *  - VORTEX_SINK       — η sink fraction of the swirl magnitude.
 *  - BRAID_LATERAL     — the shoal has to push water around itself, otherwise
 *    the split channel is visible in the mesh and absent from the hull.
 *
 * `braid` writes bed as a *maximum*, not an accumulation: the shoal is an
 * authored elevation the segment holds for as long as the event is live, so
 * repeated steps are idempotent and never creep to the dry clamp.
 */
export const HYDRO_INFLOW_DOWNSTREAM = 0.5;
export const HYDRO_VORTEX_SINK = 0.35;
export const HYDRO_BRAID_LATERAL = 0.75;
/**
 * Surge (ABI 14): how fast (1/s) a cell under the front takes the front's
 * stage. The front itself moves on the host (surgeFrontZ); the kernel only
 * paints the band where it is this step.
 */
export const HYDRO_SURGE_RELAX = 6;
/** g the surge kernel's bore speed uses (swe.cpp kHydroSurgeGravity). */
export const HYDRO_SURGE_GRAVITY = 9.80665;

/**
 * An authored surge runs a front from SURGE_RUN_IN metres upstream of its
 * segment's centre to as far below it, then waits SURGE_PAUSE_SECONDS and
 * sends the next — every period, for as long as its hour is live.
 */
export const SURGE_RUN_IN = 24;
export const SURGE_PAUSE_SECONDS = 12;
/** Half-thickness (m) of a surge band when the event names no radius. */
export const SURGE_DEFAULT_HALF_WIDTH = 3;

/**
 * Speed (m/s) of a bore of height `stage` running into still water `depth`
 * deep: c = √(g·h₂·(h₁ + h₂) / (2·h₁)), h₁ = depth, h₂ = depth + stage.
 */
export function surgeFrontSpeed(stage: number, depth: number, g = HYDRO_SURGE_GRAVITY): number {
  const h1 = Math.max(depth, 1e-3);
  const h2 = h1 + Math.max(stage, 0);
  return Math.sqrt((g * h2 * (h1 + h2)) / (2 * h1));
}

/**
 * Where an authored surge's front is at `timeSec` (world z; downstream is −Z),
 * or null between fronts. Fronts start at `centerZ + SURGE_RUN_IN`.
 */
export function authoredSurgeFrontZ(centerZ: number, stage: number, depth: number, timeSec: number): number | null {
  const speed = surgeFrontSpeed(stage, depth);
  const travel = (2 * SURGE_RUN_IN) / speed;
  const period = travel + SURGE_PAUSE_SECONDS;
  const age = ((timeSec % period) + period) % period;
  if (age > travel) return null;
  return centerZ + SURGE_RUN_IN - speed * age;
}

export interface HydroEvent {
  id: string;
  kind: HydroEventKind;
  segmentIndex: number;
  /** Launch hours (0–23) this event is live. Omit / empty = always. */
  hours?: number[];
  centerT?: number;
  lateralOffset?: number;
  radius?: number;
  strength?: number;
}

export interface SWEEventGrid {
  h: Float32Array;
  u: Float32Array;
  w: Float32Array;
  b: Float32Array;
  width: number;
  height: number;
  cellSize: number;
  originX: number;
  originZ: number;
  stillDepth: number;
}

export function isHydroEventKind(value: unknown): value is HydroEventKind {
  return typeof value === 'string' && (HYDRO_EVENT_KINDS as readonly string[]).includes(value);
}

export function hydroKindToInt(kind: HydroEventKind): number {
  switch (kind) {
    case 'inflowPulse':
      return HYDRO_KIND_INFLOW;
    case 'vortex':
      return HYDRO_KIND_VORTEX;
    case 'braid':
      return HYDRO_KIND_BRAID;
    case 'roughness':
      return HYDRO_KIND_ROUGHNESS;
    case 'surge':
      return HYDRO_KIND_SURGE;
    default:
      return HYDRO_KIND_INFLOW;
  }
}

export function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  const wrapped = ((Math.floor(hour) % 24) + 24) % 24;
  return wrapped;
}

export function isHydroEventActiveAtHour(event: HydroEvent, hour: number): boolean {
  if (!event.hours || event.hours.length === 0) return true;
  const h = normalizeHour(hour);
  return event.hours.some((candidate) => normalizeHour(candidate) === h);
}

export function eventsActiveAtHour(events: readonly HydroEvent[] | undefined, hour: number): HydroEvent[] {
  if (!events || events.length === 0) return [];
  return events.filter((event) => isHydroEventActiveAtHour(event, hour));
}

/**
 * Stable hash of the events that are live at `hour`. Ghosts store this so a
 * 06:00 run is not silently compared to a 14:00 dam pulse.
 *
 * `weatherKey` (weatherInflow.weatherFairnessKey) folds a river-changing
 * weather in (#464). It is '' for clear, so a clear run hashes exactly as it
 * did before weather existed and stored ghosts stay valid.
 */
export function hashHydroEvents(
  events: readonly HydroEvent[] | undefined,
  hour: number,
  weatherKey = '',
): string {
  const active = eventsActiveAtHour(events, hour)
    .map((event) => ({
      id: event.id,
      kind: event.kind,
      segmentIndex: event.segmentIndex,
      hours: [...(event.hours ?? [])].sort((a, b) => a - b),
      radius: event.radius ?? 0,
      strength: event.strength ?? 0,
      centerT: event.centerT ?? 0.5,
      lateralOffset: event.lateralOffset ?? 0,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const body = JSON.stringify(active);
  return fnv1aHex(weatherKey ? `${body}|weather:${weatherKey}` : body);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function parseHydroEvents(raw: unknown): HydroEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: HydroEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue;
    if (!isHydroEventKind(rec.kind)) continue;
    if (typeof rec.segmentIndex !== 'number' || rec.segmentIndex < 0) continue;
    const hours = Array.isArray(rec.hours)
      ? rec.hours.filter((h): h is number => typeof h === 'number' && h >= 0 && h <= 23)
      : undefined;
    out.push({
      id: rec.id,
      kind: rec.kind,
      segmentIndex: rec.segmentIndex,
      ...(hours && hours.length > 0 ? { hours } : {}),
      ...(typeof rec.centerT === 'number' ? { centerT: rec.centerT } : {}),
      ...(typeof rec.lateralOffset === 'number' ? { lateralOffset: rec.lateralOffset } : {}),
      ...(typeof rec.radius === 'number' ? { radius: rec.radius } : {}),
      ...(typeof rec.strength === 'number' ? { strength: rec.strength } : {}),
    });
  }
  return out;
}

/**
 * TypeScript twin of `applySWEEvent` (ABI 8). Used when the WASM export is
 * missing and by unit tests. Mutates the same arrays the stepper owns.
 */
export function applySWEEventFallback(
  grid: SWEEventGrid,
  kind: number,
  cx: number,
  cz: number,
  radius: number,
  strength: number,
  dt: number,
): void {
  const r = Math.max(0.5, radius);
  const r2 = r * r;
  const mag = Math.max(0, strength);
  const step = Math.max(0, dt);
  const { width, height, cellSize, originX, originZ, stillDepth } = grid;
  // A surge front is a band across the whole window: only its distance in z counts.
  const band = kind === HYDRO_KIND_SURGE;

  for (let j = 0; j < height; j += 1) {
    const wz = originZ + j * cellSize;
    const dz = wz - cz;
    for (let i = 0; i < width; i += 1) {
      const wx = originX + i * cellSize;
      const dx = band ? 0 : wx - cx;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const dist = Math.sqrt(d2);
      const wgt = 1 - dist / r;
      const idx = j * width + i;
      if (kind === HYDRO_KIND_INFLOW) {
        grid.h[idx] += mag * step * wgt;
        // Downstream is −Z; the released volume arrives moving.
        grid.w[idx] -= mag * step * wgt * HYDRO_INFLOW_DOWNSTREAM;
      } else if (kind === HYDRO_KIND_VORTEX) {
        grid.h[idx] -= mag * step * wgt * HYDRO_VORTEX_SINK;
        const inv = dist > 1e-4 ? 1 / dist : 0;
        grid.u[idx] += -dz * inv * mag * step * wgt;
        grid.w[idx] += dx * inv * mag * step * wgt;
      } else if (kind === HYDRO_KIND_BRAID) {
        const shoal = Math.min(stillDepth + 2, mag * wgt);
        if (shoal > grid.b[idx]) grid.b[idx] = shoal;
        // Water goes around the shoal, not through it: lateral push away from
        // the braid axis, strongest at the crest.
        const side = dx >= 0 ? 1 : -1;
        grid.u[idx] += side * mag * step * wgt * HYDRO_BRAID_LATERAL;
      } else if (kind === HYDRO_KIND_ROUGHNESS) {
        const damp = Math.max(0, 1 - mag * step * wgt);
        grid.u[idx] *= damp;
        grid.w[idx] *= damp;
      } else if (kind === HYDRO_KIND_SURGE) {
        // The front's stage here and the downstream speed a simple wave of
        // that height carries; only raises (water above the step stays).
        const still = stillDepth > 0 ? stillDepth : 1.2;
        const stage = Math.min(mag * wgt, still);
        if (grid.h[idx] < stage) {
          const k = Math.min(1, HYDRO_SURGE_RELAX * step);
          grid.h[idx] += (stage - grid.h[idx]) * k;
          const carried =
            -2 * (Math.sqrt(HYDRO_SURGE_GRAVITY * (still + stage)) - Math.sqrt(HYDRO_SURGE_GRAVITY * still));
          if (grid.w[idx] > carried) grid.w[idx] += (carried - grid.w[idx]) * k;
        }
      }
    }
  }
}

/**
 * Apply the events live at `hour`. `timeSec` is the run's sim clock: a surge
 * front's position along its segment is a function of it (authoredSurgeFrontZ),
 * so two runs stepped alike paint the same band on the same step.
 */
export function applyHydroEventsToGrid(
  grid: SWEEventGrid,
  events: readonly HydroEvent[],
  hour: number,
  worldOf: (event: HydroEvent) => { x: number; z: number } | null,
  dt: number,
  nativeApply?: (
    kind: number,
    cx: number,
    cz: number,
    radius: number,
    strength: number,
    dt: number,
  ) => void,
  timeSec = 0,
): number {
  const active = eventsActiveAtHour(events, hour);
  let applied = 0;
  for (const event of active) {
    const world = worldOf(event);
    if (!world) continue;
    const kind = hydroKindToInt(event.kind);
    const surge = kind === HYDRO_KIND_SURGE;
    const radius = event.radius ?? (surge ? SURGE_DEFAULT_HALF_WIDTH : 8);
    const strength = event.strength ?? 1;
    const cx = world.x + (event.lateralOffset ?? 0);
    const front = surge ? authoredSurgeFrontZ(world.z, strength, grid.stillDepth, timeSec) : world.z;
    if (front === null) continue;
    const cz = front;
    if (nativeApply) {
      nativeApply(kind, cx, cz, radius, strength, dt);
    } else {
      applySWEEventFallback(grid, kind, cx, cz, radius, strength, dt);
    }
    applied += 1;
  }
  return applied;
}

/**
 * Segment indices owning a live `vortex` event at `hour`.
 *
 * One field, one owner: `VortexForceSystem` must not add Rapier centripetal
 * impulses on a segment whose swirl is already in the SWE `u,w` the hull
 * samples, or the player is pulled twice (#397).
 */
export function hydroVortexSegments(
  events: readonly HydroEvent[] | undefined,
  hour: number,
): Set<number> {
  const out = new Set<number>();
  for (const event of eventsActiveAtHour(events, hour)) {
    if (event.kind === 'vortex') out.add(event.segmentIndex);
  }
  return out;
}
