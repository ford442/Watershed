/**
 * hazardTypes — what a map authors as `hazards[]`, and the lifecycle a hazard runs (#522 A).
 *
 * A hazard is a set-piece the river throws at the player that *reads the
 * simulated water*: a log jam that breaks on the dam pulse, an ice bridge that
 * cracks with melt, a release surge down a spillway, a storm's flash flood.
 * This module is the skeleton every one of them shares. Per-kind look, sound
 * and tuning (#522 B) sit on top of it and do not change the lifecycle:
 *
 *   dormant ──(live at the launch hour, player within armDistance)──▶ armed
 *   armed   ──(trigger fires)──────────────────────────────────────▶ telegraph
 *   telegraph ──(telegraphSeconds ≥ HAZARD_MIN_TELEGRAPH_SECONDS)───▶ active
 *   active  ──(activeSeconds)──────────────────────────────────────▶ spent
 *
 * `spent` is terminal for the run; a run reset puts every hazard back to
 * `dormant`. A hazard that is not live at the run's launch hour (its `hours`,
 * or the hours of the `hydroEventId` it follows) never leaves `dormant`.
 *
 * Every clock here is SimCore's fixed step — never the wall clock — so a
 * replay of a run reaches every transition on the same step.
 */

export const HAZARD_KINDS = ['logJam', 'iceBridge', 'damRelease', 'flashFlood'] as const;
export type HazardKind = (typeof HAZARD_KINDS)[number];

export const HAZARD_PHASES = ['dormant', 'armed', 'telegraph', 'active', 'spent'] as const;
export type HazardPhase = (typeof HAZARD_PHASES)[number];

/**
 * The shortest warning a hazard may give before it becomes dangerous (#522
 * acceptance). The schema's minimum and the parser's clamp both use it.
 */
export const HAZARD_MIN_TELEGRAPH_SECONDS = 1.5;
export const HAZARD_DEFAULT_TELEGRAPH_SECONDS = 2.5;
export const HAZARD_DEFAULT_ACTIVE_SECONDS = 6;
/** Horizontal metres from the anchor within which a live hazard arms. */
export const HAZARD_DEFAULT_ARM_DISTANCE = 150;
/** Horizontal metres from the anchor an active hazard reaches the player within. */
export const HAZARD_DEFAULT_RADIUS = 8;

/**
 * What fires an armed hazard. Deterministic on the sim clock and the sampled
 * world:
 *
 *  - `proximity` — the player comes within `distance` m (horizontal) of the anchor.
 *  - `stage`     — the SWE stage η at the anchor reaches `above` m (a flood, a
 *                  surge front arriving). With `distance`, the player must also
 *                  be that close. With no SWE field (Low quality) the stage is
 *                  unknown and, when `distance` is given, the trigger falls back
 *                  to proximity so the hazard still happens.
 *  - `delay`     — `seconds` after the hazard armed (a siren on a schedule).
 */
export type HazardTrigger =
  | { type: 'proximity'; distance: number }
  | { type: 'stage'; above: number; distance?: number }
  | { type: 'delay'; seconds: number };

/** What an active hazard does to a player it reaches: the survival layer, never an instant reset. */
export interface HazardConsequence {
  /** Wetness added, 0–1 (survivalState.wetness). */
  wetness?: number;
  /** Core temperature taken, 0–1 (survivalState.coreTemp). */
  chill?: number;
}

export interface HazardConfig {
  /** Unique within the map; the ghost's hazard log is keyed on it. */
  id: string;
  kind: HazardKind;
  segmentIndex: number;
  /** Path parameter of the anchor along its segment, 0–1 (default 0.5). */
  centerT?: number;
  /** Metres right of the centreline (negative = left bank). */
  lateralOffset?: number;
  /** Reach of the active hazard, metres horizontal. */
  radius?: number;
  /** Launch hours (0–23) the hazard is live. Omit / empty = always (unless it follows a hydro event). */
  hours?: number[];
  /**
   * The `hydroEvents[]` id this hazard follows: it is live exactly when that
   * event is live at the launch hour (the dam's surge, the storm's inflow), so
   * the water and the set-piece can never disagree about the hour.
   */
  hydroEventId?: string;
  armDistance?: number;
  trigger: HazardTrigger;
  telegraphSeconds?: number;
  activeSeconds?: number;
  consequence?: HazardConsequence;
}

/** One line of a run's hazard log: a phase entered, or the player reached. Rides in the `.wsghost`. */
export interface HazardLogEntry {
  hazardId: string;
  event: HazardPhase | 'hit';
  /** Ghost clock (ms) when it happened — the clock splits are read off. */
  tMs: number;
}

export function isHazardKind(value: unknown): value is HazardKind {
  return typeof value === 'string' && (HAZARD_KINDS as readonly string[]).includes(value);
}
