/**
 * trestleSpan.ts — how much deck a lumber trestle still has at this hour.
 *
 * The flume's broken trestle was decoration: `buildLumberPropPositions` scattered
 * static planks and the segment comment said so ("visual only, not breakable").
 * This module is the spec that comment described, made deterministic and pure:
 * given the authored `hasBridge`, the forecast state the treadmill already
 * computed, and the `hydroEvents[]` live at the run's launch hour, it says which
 * planks are on the segment, how wide the hole in the middle is, and how fast
 * you have to hit an intact plank to snap it.
 *
 * Three inputs, one number (`washout`), because the coupling is the point:
 *
 *  - forecast state  — WashedOut already opens authored gaps everywhere else.
 *  - `braid` event   — the flood-hour shoal at the gap (lumber 13:00–15:00);
 *                      the water going around the trestle is what takes the
 *                      deck out, so it widens the hole.
 *  - `roughness`     — the dawn backwater (05:00–07:00) damps `u,w`; slack
 *                      water leaves the deck standing, so it narrows the hole.
 *
 * No Three.js / Rapier imports — the span is unit-testable on its own, and the
 * renderer only turns it into bodies.
 */

import { FLOW_FORECAST_STATES, type FlowForecastState } from '../../constants/game';
import { eventsActiveAtHour, type HydroEvent } from '../water/hydroEvents';

/** Deck boards laid across the corridor when the trestle is fully intact. */
export const TRESTLE_PLANK_COUNT = 12;

/** Span extent along the segment path, as curve parameters. */
export const TRESTLE_SPAN_T0 = 0.26;
export const TRESTLE_SPAN_T1 = 0.8;

/** Deck board footprint (metres): along-path length × across-channel width. */
export const TRESTLE_PLANK_LENGTH = 3.2;
export const TRESTLE_PLANK_THICKNESS = 0.34;

/** Deck height above the water surface. */
export const TRESTLE_DECK_HEIGHT = 1.15;

/** Impact speed (m/s) that snaps a plank when the deck is dry and sound. */
export const TRESTLE_BREAK_SPEED_DRY = 13;

/** Impact speed that snaps a plank on a fully washed-out hour. */
export const TRESTLE_BREAK_SPEED_SOAKED = 5.5;

/** Forecast contribution to washout, before hydro events. */
const STATE_WASHOUT: Record<FlowForecastState, number> = {
  [FLOW_FORECAST_STATES.NORMAL]: 0,
  [FLOW_FORECAST_STATES.HIGH_FLOW]: 0.22,
  [FLOW_FORECAST_STATES.FLOODED]: 0.52,
  [FLOW_FORECAST_STATES.WASHED_OUT]: 0.84,
};

/** Per-unit-strength washout a live `braid` adds / a `roughness` holds back. */
const BRAID_WASHOUT_PER_STRENGTH = 0.14;
const BRAID_WASHOUT_CAP = 0.5;
const ROUGHNESS_HOLD_PER_STRENGTH = 0.1;
const ROUGHNESS_HOLD_CAP = 0.3;

export interface TrestlePlank {
  /** Stable index within the span, upstream → downstream. */
  index: number;
  /** Curve parameter where the plank crosses the path. */
  t: number;
  /** Across-channel offset of the plank centre, in metres. */
  lateralOffset: number;
  /** Plank width across the channel, in metres. */
  width: number;
}

export interface TrestleSpan {
  /** False when the segment authored no bridge — nothing to render. */
  present: boolean;
  /** Deck boards that survive to the start of the run. */
  planks: TrestlePlank[];
  /** Plank indices missing from the deck (the hole), ascending. */
  missing: number[];
  /** Missing fraction of the span, 0 (sound) – 1 (no deck at all). */
  gapFraction: number;
  /** Hole width in metres along the path, for HUD / authoring readouts. */
  gapLength: number;
  /** Impact speed (m/s) that snaps a plank that is still standing. */
  breakSpeed: number;
  /** The blended forecast + event washout the rest is derived from, 0–1. */
  washout: number;
}

export interface TrestleSpanInput {
  /** Authored `hasBridge` on the segment. */
  hasBridge: boolean;
  /** Forecast state the treadmill applied to this segment. */
  segmentState: FlowForecastState | string;
  /** Forecast already forced a gap here (`washedOutGap`). */
  washedOutGap?: boolean;
  /** The map's `hydroEvents[]` (all of them — filtered here by hour + segment). */
  events?: readonly HydroEvent[];
  /** Segment index the events are keyed by. */
  segmentIndex: number;
  /** Run launch hour. */
  hour: number;
  /** Channel width at the water surface — sets plank width. */
  waterWidth: number;
  /** Segment path length in metres, for `gapLength`. */
  pathLength: number;
}

const EMPTY_SPAN: TrestleSpan = {
  present: false,
  planks: [],
  missing: [],
  gapFraction: 0,
  gapLength: 0,
  breakSpeed: TRESTLE_BREAK_SPEED_DRY,
  washout: 0,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function coerceState(state: FlowForecastState | string): FlowForecastState {
  return (STATE_WASHOUT as Record<string, number>)[state] !== undefined
    ? (state as FlowForecastState)
    : FLOW_FORECAST_STATES.NORMAL;
}

/**
 * Blend the forecast state with the segment's live hydro events into a single
 * 0–1 washout. This is the whole coupling: change any one input and the deck
 * changes with it.
 */
export function trestleWashout(input: {
  segmentState: FlowForecastState | string;
  washedOutGap?: boolean;
  events?: readonly HydroEvent[];
  segmentIndex: number;
  hour: number;
}): number {
  let washout = STATE_WASHOUT[coerceState(input.segmentState)];
  if (input.washedOutGap) {
    washout = Math.max(washout, STATE_WASHOUT[FLOW_FORECAST_STATES.WASHED_OUT]);
  }

  let braid = 0;
  let hold = 0;
  for (const event of eventsActiveAtHour(input.events, input.hour)) {
    if (event.segmentIndex !== input.segmentIndex) continue;
    const strength = Math.max(0, event.strength ?? 1);
    if (event.kind === 'braid') {
      braid += strength * BRAID_WASHOUT_PER_STRENGTH;
    } else if (event.kind === 'roughness') {
      hold += strength * ROUGHNESS_HOLD_PER_STRENGTH;
    }
  }

  return clamp01(
    washout + Math.min(BRAID_WASHOUT_CAP, braid) - Math.min(ROUGHNESS_HOLD_CAP, hold),
  );
}

/**
 * Resolve the deck for one segment at one launch hour.
 *
 * The hole opens from the middle outward — a trestle fails at mid-span, and it
 * keeps the approach boards you need to carry speed onto the launch.
 */
export function resolveTrestleSpan(input: TrestleSpanInput): TrestleSpan {
  if (!input.hasBridge) return { ...EMPTY_SPAN, planks: [], missing: [] };

  const washout = trestleWashout(input);
  const missingCount = Math.min(
    TRESTLE_PLANK_COUNT,
    Math.round(washout * TRESTLE_PLANK_COUNT),
  );

  // Centred hole: for an odd count the extra board comes off the downstream
  // side, so the take-off lip erodes before the run-up does.
  const firstMissing = Math.floor((TRESTLE_PLANK_COUNT - missingCount) / 2);
  const missing: number[] = [];
  for (let i = 0; i < missingCount; i += 1) missing.push(firstMissing + i);
  const missingSet = new Set(missing);

  const width = Math.max(2, (Number.isFinite(input.waterWidth) ? input.waterWidth : 8) + 2.5);
  const spanT = TRESTLE_SPAN_T1 - TRESTLE_SPAN_T0;
  const planks: TrestlePlank[] = [];
  for (let i = 0; i < TRESTLE_PLANK_COUNT; i += 1) {
    if (missingSet.has(i)) continue;
    planks.push({
      index: i,
      t: TRESTLE_SPAN_T0 + (spanT * (i + 0.5)) / TRESTLE_PLANK_COUNT,
      // Alternating sag so the deck reads as timber, not a ramp.
      lateralOffset: (i % 2 === 0 ? 1 : -1) * 0.12,
      width,
    });
  }

  const pathLength = Number.isFinite(input.pathLength) ? Math.max(0, input.pathLength) : 0;
  const gapFraction = missingCount / TRESTLE_PLANK_COUNT;

  return {
    present: true,
    planks,
    missing,
    gapFraction,
    gapLength: gapFraction * spanT * pathLength,
    breakSpeed:
      TRESTLE_BREAK_SPEED_DRY +
      (TRESTLE_BREAK_SPEED_SOAKED - TRESTLE_BREAK_SPEED_DRY) * washout,
    washout,
  };
}
