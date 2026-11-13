/**
 * hydroFairness — launchHour + hydroEventHash + quality on .wsghost (#391 Phase B).
 *
 * Offline only. A rival or PB ghost from a different launch hour or hydro
 * event set is *refused* (not raced, and the UI says why — #438 E1); a quality
 * mismatch is labeled only, since it changes pixels and the SWE grid budget
 * but not which authored events are live. Pre-v3 files carry no fairness
 * fields and race as "unverified".
 */

import type { QualityPreset } from '../GameState';
import type { HydroEvent } from '../water/hydroEvents';
import { hashHydroEvents, eventsActiveAtHour } from '../water/hydroEvents';
import { weatherFairnessKey, type RunWeather } from '../map/weatherInflow';
import { sanitizeAssistBits } from '../settings/access';

export interface GhostHydroFairness {
  launchHour?: number;
  hydroEventHash?: string;
  qualityPreset?: QualityPreset;
  /** Assists bitfield (#558 D.2); absent / 0 = unassisted. Runs with different assists never race. */
  assists?: number;
}

export function buildGhostHydroFairness(input: {
  launchHour: number;
  events?: readonly HydroEvent[];
  qualityPreset: QualityPreset;
  /** Run weather; a storm or snow river hashes apart from a clear one (#464). */
  weather?: RunWeather | null;
  /**
   * The run's whole conditions key (weather script, melt inputs, daily seed —
   * `runConditionsFairnessKey`); wins over `weather`. '' for a clear default day.
   */
  conditionsKey?: string;
  /** The run's assists bits; 0 / absent adds nothing (an unassisted run is unchanged). */
  assists?: number;
}): GhostHydroFairness {
  const key = input.conditionsKey ?? weatherFairnessKey(input.weather);
  return {
    launchHour: input.launchHour,
    hydroEventHash: hashHydroEvents(input.events, input.launchHour, key),
    qualityPreset: input.qualityPreset,
    ...(input.assists ? { assists: input.assists } : {}),
  };
}

/**
 * `H14:00` in the verdict messages below. UI code formats hours with
 * `formatLaunchHour` from src/i18n/format.ts (localised).
 */
export function formatLaunchHour(hour: number): string {
  return `H${String(hour).padStart(2, '0')}:00`;
}

/** Short form of a hydro hash for HUD / results (full hash stays in the file). */
export function shortHydroHash(hash: string | undefined): string {
  return hash ? hash.slice(0, 6) : '——';
}

export type GhostFairnessVerdict =
  | { kind: 'match' }
  /** Ghost predates codec v3 (no hour/hash) — raced, but labeled. */
  | { kind: 'unverified'; message: string }
  | { kind: 'refused'; reason: 'hour_mismatch' | 'hydro_mismatch' | 'assist_mismatch'; message: string };

/**
 * Decide whether `ghost` may be raced under `current` conditions. Hour or
 * hydro-hash mismatch refuses; missing fields on the ghost (v1/v2 file, or a
 * PB saved before fairness was recorded) race as unverified.
 */
export function judgeGhostFairness(
  current: GhostHydroFairness,
  ghost: GhostHydroFairness | null | undefined,
  label: 'PB' | 'rival',
): GhostFairnessVerdict {
  const ghostHour = ghost?.launchHour;
  const ghostHash = ghost?.hydroEventHash;
  // An assisted run and an unassisted one (or two different assist sets) are not
  // the same race (#558 D.2) — refused like a different river.
  const ghostAssists = ghost?.assists ?? 0;
  const currentAssists = current.assists ?? 0;
  if (ghostAssists !== currentAssists) {
    return {
      kind: 'refused',
      reason: 'assist_mismatch',
      message: ghostAssists
        ? `${label} was an assisted run — this run is ${currentAssists ? 'assisted differently' : 'unassisted'}`
        : `${label} was unassisted — this run is assisted`,
    };
  }
  if (ghostHour !== undefined && current.launchHour !== undefined && ghostHour !== current.launchHour) {
    return {
      kind: 'refused',
      reason: 'hour_mismatch',
      message: `${label} was ${formatLaunchHour(ghostHour)} — you launched ${formatLaunchHour(current.launchHour)}`,
    };
  }
  if (ghostHash && current.hydroEventHash && ghostHash !== current.hydroEventHash) {
    return {
      kind: 'refused',
      reason: 'hydro_mismatch',
      message: `${label} ran hydro ${shortHydroHash(ghostHash)} — this river is ${shortHydroHash(current.hydroEventHash)}`,
    };
  }
  if (ghostHour === undefined || !ghostHash) {
    return { kind: 'unverified', message: `${label} has no launch hour — unverified river` };
  }
  return { kind: 'match' };
}

export function hydroFairnessDiffers(a?: GhostHydroFairness | null, b?: GhostHydroFairness | null): boolean {
  if (!a && !b) return false;
  const hourA = a?.launchHour;
  const hourB = b?.launchHour;
  const hashA = a?.hydroEventHash;
  const hashB = b?.hydroEventHash;
  const qualityA = a?.qualityPreset;
  const qualityB = b?.qualityPreset;
  if (hourA !== undefined && hourB !== undefined && hourA !== hourB) return true;
  if (hashA && hashB && hashA !== hashB) return true;
  if (qualityA && qualityB && qualityA !== qualityB) return true;
  if ((a?.assists ?? 0) !== (b?.assists ?? 0)) return true;
  return false;
}

/** One field that differs between two runs' rivers (RunResultsPanel words it, #566). */
export type HydroFairnessDiff =
  | { field: 'launch'; self: number; other: number }
  | { field: 'hydro'; self: string; other: string }
  | { field: 'quality'; self: QualityPreset; other: QualityPreset };

/**
 * What differs between `self` and `other`, or null when nothing does. An empty
 * list means they differ in a way neither side recorded ("a different river").
 */
export function hydroFairnessMismatch(
  self: GhostHydroFairness | null | undefined,
  other: GhostHydroFairness | null | undefined,
): HydroFairnessDiff[] | null {
  if (!hydroFairnessDiffers(self, other)) return null;
  const diffs: HydroFairnessDiff[] = [];
  if (
    self?.launchHour !== undefined &&
    other?.launchHour !== undefined &&
    self.launchHour !== other.launchHour
  ) {
    diffs.push({ field: 'launch', self: self.launchHour, other: other.launchHour });
  }
  if (self?.hydroEventHash && other?.hydroEventHash && self.hydroEventHash !== other.hydroEventHash) {
    diffs.push({ field: 'hydro', self: self.hydroEventHash, other: other.hydroEventHash });
  }
  if (self?.qualityPreset && other?.qualityPreset && self.qualityPreset !== other.qualityPreset) {
    diffs.push({ field: 'quality', self: self.qualityPreset, other: other.qualityPreset });
  }
  return diffs;
}

/** The hydro event a lost split is blamed on: data, worded by RunResultsPanel (#566). */
export interface HydroSplitBlame {
  eventId: string;
  kind: HydroEvent['kind'];
  /** Seconds lost on that segment against the reference. */
  seconds: number;
}

/**
 * Blame the largest positive split delta on the hydro event that owns that
 * segment, so results can say the dam pulse cost the time — not the shelf.
 */
export function hydroSplitBlame(
  rows: ReadonlyArray<{ segmentIndex: number; deltaMs: number | null }>,
  events: readonly HydroEvent[] | undefined,
  hour: number,
): HydroSplitBlame | null {
  const active = eventsActiveAtHour(events, hour);
  if (active.length === 0) return null;
  let worst: { segmentIndex: number; deltaMs: number } | null = null;
  for (const row of rows) {
    if (row.deltaMs === null || row.deltaMs <= 0) continue;
    if (!worst || row.deltaMs > worst.deltaMs) {
      worst = { segmentIndex: row.segmentIndex, deltaMs: row.deltaMs };
    }
  }
  if (!worst) return null;
  const event = active.find((item) => item.segmentIndex === worst!.segmentIndex);
  if (!event) return null;
  return { eventId: event.id, kind: event.kind, seconds: worst.deltaMs / 1000 };
}

export function fairnessFromGhostFile(file: {
  launchHour?: number;
  hydroEventHash?: string;
  qualityPreset?: QualityPreset;
  assists?: number;
}): GhostHydroFairness {
  return {
    launchHour: file.launchHour,
    hydroEventHash: file.hydroEventHash,
    qualityPreset: file.qualityPreset,
    ...(file.assists ? { assists: sanitizeAssistBits(file.assists) } : {}),
  };
}
