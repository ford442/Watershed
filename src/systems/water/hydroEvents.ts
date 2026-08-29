/**
 * hydroEvents — authored source terms on the SWE grid (#389 / #391).
 *
 * Maps declare `hydroEvents[]`. At the run's launch hour, active events
 * write mass / momentum / bed into the same `(η,u,w,b)` field the mesh and
 * Rapier already sample. This is not a sixth decoration type.
 */

export const HYDRO_EVENT_KINDS = ['inflowPulse', 'vortex', 'braid', 'roughness'] as const;
export type HydroEventKind = (typeof HYDRO_EVENT_KINDS)[number];

/** Packed kind ids matching `applySWEEvent` in emscripten/swe.cpp. */
export const HYDRO_KIND_INFLOW = 0;
export const HYDRO_KIND_VORTEX = 1;
export const HYDRO_KIND_BRAID = 2;
export const HYDRO_KIND_ROUGHNESS = 3;

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
 */
export function hashHydroEvents(events: readonly HydroEvent[] | undefined, hour: number): string {
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
  return fnv1aHex(JSON.stringify(active));
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

  for (let j = 0; j < height; j += 1) {
    const wz = originZ + j * cellSize;
    const dz = wz - cz;
    for (let i = 0; i < width; i += 1) {
      const wx = originX + i * cellSize;
      const dx = wx - cx;
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) continue;
      const dist = Math.sqrt(d2);
      const wgt = 1 - dist / r;
      const idx = j * width + i;
      if (kind === HYDRO_KIND_INFLOW) {
        grid.h[idx] += mag * step * wgt;
      } else if (kind === HYDRO_KIND_VORTEX) {
        grid.h[idx] -= mag * step * wgt * 0.35;
        const inv = dist > 1e-4 ? 1 / dist : 0;
        grid.u[idx] += -dz * inv * mag * step * wgt;
        grid.w[idx] += dx * inv * mag * step * wgt;
      } else if (kind === HYDRO_KIND_BRAID) {
        grid.b[idx] = Math.min(stillDepth + 2, grid.b[idx] + mag * wgt);
      } else if (kind === HYDRO_KIND_ROUGHNESS) {
        const damp = Math.max(0, 1 - mag * step * wgt);
        grid.u[idx] *= damp;
        grid.w[idx] *= damp;
      }
    }
  }
}

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
): number {
  const active = eventsActiveAtHour(events, hour);
  let applied = 0;
  for (const event of active) {
    const world = worldOf(event);
    if (!world) continue;
    const kind = hydroKindToInt(event.kind);
    const radius = event.radius ?? 8;
    const strength = event.strength ?? 1;
    const cx = world.x + (event.lateralOffset ?? 0);
    const cz = world.z;
    if (nativeApply) {
      nativeApply(kind, cx, cz, radius, strength, dt);
    } else {
      applySWEEventFallback(grid, kind, cx, cz, radius, strength, dt);
    }
    applied += 1;
  }
  return applied;
}
