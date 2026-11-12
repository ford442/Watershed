/**
 * editorSegments.ts — the Workshop's view of a `LevelData`, and the way back.
 *
 * The Workshop store (workshopStore.ts) holds the `LevelData` itself as its
 * source of truth (#River Workshop A.2). The inspector panels still speak the
 * flattened `EditorSegmentConfig` the 2025 editor used, so this module is the
 * pair of pure functions between the two:
 *
 *   - `levelToEditorSegments(level)` — derive the inspector rows (memoised per
 *     level object, so a selector can call it on every render);
 *   - `applySegmentEdit(level, index, updates)` — write an inspector edit back
 *     into a *new* `LevelData`, touching only the fields the inspector owns.
 *
 * Everything the inspector does not edit (`hazards[]`, `segments[].gameplay`,
 * `washedOutGap`, set-piece placement arrays, weather, atmosphere, spawns, …)
 * passes through untouched, so opening a campaign map and exporting it is a
 * byte-for-byte round trip of the fields nobody touched. The old hook rebuilt
 * the export from its flattened rows and dropped all of those.
 */

import * as THREE from 'three';
import type { HydroEvent, HydroEventKind } from '../systems/water/hydroEvents';
import { parseHydroEvents } from '../systems/water/hydroEvents';
import type { LevelData, LevelSegment } from '../systems/map/MapSystem.types';

export interface EditorSegmentConfig {
  /** String identifier, e.g. "segment-0" */
  id: string;
  /** Zero-based sequence number */
  index: number;
  type: 'normal' | 'waterfall' | 'pond' | 'splash' | 'rapids';
  /** Resolved biome (biomeOverride ?? world biome) */
  biome: string;
  /** Per-segment biome override; undefined = inherit world biome */
  biomeOverride?: string;
  name?: string;
  startPoint: [number, number, number];
  endPoint: [number, number, number];
  /** Two intermediate control points for the segment curve */
  controlPoints: [number, number, number][];
  /** Canyon width; inherits from world track width when undefined */
  width?: number;
  /** Maps to meanderStrength in the JSON format */
  meanderAmount: number;
  verticalBias: number;
  forwardMomentum: number;
  /** Shorthand rock count from decorations.rocks */
  rockDensity: number;
  /** All decorations as plain counts (arrays are collapsed to length) */
  decorations: Record<string, number>;
  difficulty: number;
  /** Approximate arc length in world units */
  length: number;
  physics?: LevelSegment['physics'];
  safeZone?: LevelSegment['safeZone'];
  effects?: LevelSegment['effects'];
  /** Optional SWE source term authored on this segment. */
  hydroKind?: HydroEventKind | '';
  hydroHours?: string;
  hydroRadius?: number;
  hydroStrength?: number;
}

type Vec3 = [number, number, number];

function vec3ToTuple(v: THREE.Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function decorationCounts(raw: LevelSegment['decorations']): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.length;
  }
  return out;
}

/** The level's spline as a curve (the same CatmullRom the treadmill's preview uses). */
export function levelWaypoints(level: LevelData): Vec3[] {
  const raw = level.world?.track?.waypoints ?? [];
  return raw.map((wp) => [wp[0] ?? 0, wp[1] ?? 0, wp[2] ?? 0]);
}

function buildRow(
  seg: LevelSegment,
  curve: THREE.CatmullRomCurve3 | null,
  totalSegments: number,
  worldBiome: string,
  worldWidth: number,
  hydro: HydroEvent | undefined,
): EditorSegmentConfig {
  const tStart = totalSegments > 0 ? Math.min(1, seg.index / totalSegments) : 0;
  const tEnd = totalSegments > 0 ? Math.min(1, (seg.index + 1) / totalSegments) : 0;
  const at = (t: number): Vec3 => (curve ? vec3ToTuple(curve.getPoint(t)) : [0, 0, 0]);

  let length = 0;
  if (curve) {
    let prev = curve.getPoint(tStart);
    for (let i = 1; i <= 10; i++) {
      const cur = curve.getPoint(tStart + (tEnd - tStart) * (i / 10));
      length += prev.distanceTo(cur);
      prev = cur;
    }
  }

  const decorations = decorationCounts(seg.decorations);
  return {
    id: `segment-${seg.index}`,
    index: seg.index,
    type: seg.type ?? 'normal',
    biome: seg.biomeOverride ?? worldBiome,
    biomeOverride: seg.biomeOverride,
    name: seg.name,
    startPoint: at(tStart),
    endPoint: at(tEnd),
    controlPoints: [at(tStart + (tEnd - tStart) * 0.333), at(tStart + (tEnd - tStart) * 0.667)],
    // seg.waterWidth: legacy field name in older map JSON
    width: seg.width ?? seg.waterWidth ?? worldWidth,
    meanderAmount: seg.meanderStrength ?? 1.0,
    verticalBias: seg.verticalBias ?? -0.5,
    forwardMomentum: seg.forwardMomentum ?? 1.0,
    rockDensity: typeof decorations.rocks === 'number' ? decorations.rocks : 0,
    decorations,
    difficulty: seg.difficulty ?? 0.3,
    length,
    physics: seg.physics,
    safeZone: seg.safeZone,
    effects: seg.effects,
    ...(hydro
      ? {
          hydroKind: hydro.kind,
          hydroHours: hydro.hours?.join(',') ?? '',
          hydroRadius: hydro.radius,
          hydroStrength: hydro.strength,
        }
      : {}),
  };
}

const rowsCache = new WeakMap<LevelData, EditorSegmentConfig[]>();

/** The inspector rows for `level`; the same array back for the same level object. */
export function levelToEditorSegments(level: LevelData): EditorSegmentConfig[] {
  const cached = rowsCache.get(level);
  if (cached) return cached;
  const waypoints = levelWaypoints(level);
  const curve =
    waypoints.length >= 2
      ? new THREE.CatmullRomCurve3(waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'catmullrom', 0.5)
      : null;
  const worldBiome = level.world?.biome?.baseType ?? 'canyonSummer';
  const worldWidth = level.world?.track?.width ?? 35;
  const totalSegments = level.world?.track?.totalSegments || level.segments.length;
  // One authored source term per segment (the inspector's shape); the first wins.
  const bySegment = new Map<number, HydroEvent>();
  for (const event of parseHydroEvents(level.hydroEvents)) {
    if (!bySegment.has(event.segmentIndex)) bySegment.set(event.segmentIndex, event);
  }
  const rows = level.segments.map((seg) =>
    buildRow(seg, curve, totalSegments, worldBiome, worldWidth, bySegment.get(seg.index)),
  );
  rowsCache.set(level, rows);
  return rows;
}

function parseHoursList(raw: string | undefined): number[] | undefined {
  if (!raw || !raw.trim()) return undefined;
  const hours = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23);
  return hours.length > 0 ? hours : undefined;
}

/** Set `key` to `value` on a copy of `obj`, or drop it when `value` is undefined. */
function withField<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

const HYDRO_FIELDS = ['hydroKind', 'hydroHours', 'hydroRadius', 'hydroStrength'] as const;

function applyHydroEdit(level: LevelData, row: EditorSegmentConfig): LevelData['hydroEvents'] {
  const raw: unknown[] = Array.isArray(level.hydroEvents) ? level.hydroEvents : [];
  const isMine = (e: unknown) =>
    !!e && typeof e === 'object' && (e as { segmentIndex?: unknown }).segmentIndex === row.index;
  const existing = raw.find(isMine) as Partial<HydroEvent> | undefined;
  const rest = raw.filter((e) => e !== existing);
  if (!row.hydroKind) {
    return (rest.length > 0 ? rest : undefined) as LevelData['hydroEvents'];
  }
  const hours = parseHoursList(row.hydroHours);
  // Fields the inspector does not show (an authored id, flags) ride along.
  let event: Record<string, unknown> = {
    ...existing,
    id: existing?.id ?? `${row.hydroKind}-${row.index}`,
    kind: row.hydroKind,
    segmentIndex: row.index,
  };
  event = withField(event, 'hours', hours);
  event = withField(event, 'radius', row.hydroRadius);
  event = withField(event, 'strength', row.hydroStrength);
  const out = raw.map((e) => (e === existing ? event : e));
  if (!existing) out.push(event);
  return out as LevelData['hydroEvents'];
}

/**
 * Write an inspector edit of segment `index` into a new `LevelData`. Only the
 * fields named in `updates` change; a field set to `undefined` is removed (it
 * falls back to its default), every other field of the segment and the level
 * is carried over as authored.
 */
export function applySegmentEdit(
  level: LevelData,
  index: number,
  updates: Partial<EditorSegmentConfig>,
): LevelData {
  const pos = level.segments.findIndex((s) => s.index === index);
  if (pos < 0) return level;
  let seg: LevelSegment = { ...level.segments[pos] };
  const has = (key: keyof EditorSegmentConfig) => Object.prototype.hasOwnProperty.call(updates, key);

  if (has('name')) seg = withField(seg, 'name', updates.name || undefined);
  if (has('type')) seg = withField(seg, 'type', updates.type === 'normal' ? undefined : updates.type);
  if (has('biomeOverride')) seg = withField(seg, 'biomeOverride', updates.biomeOverride || undefined);
  if (has('difficulty')) seg = withField(seg, 'difficulty', updates.difficulty);
  if (has('width')) {
    seg = withField(seg, 'width', updates.width);
    seg = withField(seg, 'waterWidth', undefined);
  }
  if (has('meanderAmount')) seg = withField(seg, 'meanderStrength', updates.meanderAmount);
  if (has('verticalBias')) seg = withField(seg, 'verticalBias', updates.verticalBias);
  if (has('forwardMomentum')) seg = withField(seg, 'forwardMomentum', updates.forwardMomentum);
  if (has('physics')) seg = withField(seg, 'physics', updates.physics);
  if (has('safeZone')) seg = withField(seg, 'safeZone', updates.safeZone);
  if (has('effects')) seg = withField(seg, 'effects', updates.effects);

  if (has('decorations') || has('rockDensity')) {
    const counts = { ...(updates.decorations ?? decorationCounts(seg.decorations)) };
    if (has('rockDensity') && updates.rockDensity !== undefined) counts.rocks = updates.rockDensity;
    const before = seg.decorations ?? {};
    const next: Record<string, unknown> = { ...before };
    for (const [key, count] of Object.entries(counts)) {
      const prev = (before as Record<string, unknown>)[key];
      // An authored placement list keeps its placements until its count changes.
      if (Array.isArray(prev) && prev.length === count) continue;
      next[key] = count;
    }
    seg = withField(seg, 'decorations', Object.keys(next).length > 0 ? (next as LevelSegment['decorations']) : undefined);
  }

  const segments = level.segments.slice();
  segments[pos] = seg;
  let out: LevelData = { ...level, segments };

  if (HYDRO_FIELDS.some((k) => has(k))) {
    const current = levelToEditorSegments(level).find((r) => r.index === index);
    if (current) {
      const row = { ...current, ...updates };
      out = withField(out, 'hydroEvents', applyHydroEdit(level, row));
    }
  }
  return out;
}

/** Set the world's base biome (segments without an override follow it). */
export function applyWorldBiome(level: LevelData, biome: string, clearOverrides = false): LevelData {
  const world = { ...level.world, biome: { ...level.world.biome, baseType: biome } };
  const segments = clearOverrides
    ? level.segments.map((s) => (s.biomeOverride ? withField(s, 'biomeOverride', undefined) : s))
    : level.segments;
  return { ...level, world, segments };
}
