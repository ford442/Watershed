/**
 * parseHazards — `hazards[]` from map JSON into `HazardConfig`s the sim can run (#522 A).
 *
 * The registry already rejected a map whose `hazards[]` breaks the schema
 * (level.schema.json, assertLevelData). This is the runtime's own guard for
 * what it reads — a player's river, a test fixture — so a malformed entry is
 * dropped rather than stepped, and every number the lifecycle relies on is
 * clamped into range (a telegraph is never shorter than
 * HAZARD_MIN_TELEGRAPH_SECONDS, whatever the file says).
 */
import {
  HAZARD_DEFAULT_ACTIVE_SECONDS,
  HAZARD_DEFAULT_ARM_DISTANCE,
  HAZARD_DEFAULT_RADIUS,
  HAZARD_DEFAULT_TELEGRAPH_SECONDS,
  HAZARD_MIN_TELEGRAPH_SECONDS,
  isHazardKind,
  type HazardConfig,
  type HazardConsequence,
  type HazardTrigger,
} from './hazardTypes';

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;

function parseTrigger(raw: unknown): HazardTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  switch (rec.type) {
    case 'proximity':
      return positive(rec.distance) ? { type: 'proximity', distance: rec.distance } : null;
    case 'stage':
      if (!finite(rec.above)) return null;
      return positive(rec.distance)
        ? { type: 'stage', above: rec.above, distance: rec.distance }
        : { type: 'stage', above: rec.above };
    case 'delay':
      return finite(rec.seconds) && rec.seconds >= 0 ? { type: 'delay', seconds: rec.seconds } : null;
    default:
      return null;
  }
}

function parseConsequence(raw: unknown): HazardConsequence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const rec = raw as Record<string, unknown>;
  const out: HazardConsequence = {};
  if (finite(rec.wetness)) out.wetness = Math.min(1, Math.max(0, rec.wetness));
  if (finite(rec.chill)) out.chill = Math.min(1, Math.max(0, rec.chill));
  return out.wetness !== undefined || out.chill !== undefined ? out : undefined;
}

/** Valid hazards in authored order; duplicates of an earlier id are dropped. */
export function parseHazards(raw: unknown): HazardConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: HazardConfig[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec.id !== 'string' || rec.id.length === 0 || seen.has(rec.id)) continue;
    if (!isHazardKind(rec.kind)) continue;
    if (!Number.isInteger(rec.segmentIndex) || (rec.segmentIndex as number) < 0) continue;
    const trigger = parseTrigger(rec.trigger);
    if (!trigger) continue;
    seen.add(rec.id);

    const hours = Array.isArray(rec.hours)
      ? rec.hours.filter((h): h is number => Number.isInteger(h) && (h as number) >= 0 && (h as number) <= 23)
      : [];
    const consequence = parseConsequence(rec.consequence);
    out.push({
      id: rec.id,
      kind: rec.kind,
      segmentIndex: rec.segmentIndex as number,
      centerT: finite(rec.centerT) ? Math.min(1, Math.max(0, rec.centerT)) : 0.5,
      lateralOffset: finite(rec.lateralOffset) ? rec.lateralOffset : 0,
      radius: positive(rec.radius) ? rec.radius : HAZARD_DEFAULT_RADIUS,
      ...(hours.length > 0 ? { hours } : {}),
      ...(typeof rec.hydroEventId === 'string' && rec.hydroEventId.length > 0
        ? { hydroEventId: rec.hydroEventId }
        : {}),
      armDistance: positive(rec.armDistance) ? rec.armDistance : HAZARD_DEFAULT_ARM_DISTANCE,
      trigger,
      telegraphSeconds: Math.max(
        HAZARD_MIN_TELEGRAPH_SECONDS,
        finite(rec.telegraphSeconds) ? rec.telegraphSeconds : HAZARD_DEFAULT_TELEGRAPH_SECONDS,
      ),
      activeSeconds: positive(rec.activeSeconds) ? rec.activeSeconds : HAZARD_DEFAULT_ACTIVE_SECONDS,
      ...(consequence ? { consequence } : {}),
    });
  }
  return out;
}
