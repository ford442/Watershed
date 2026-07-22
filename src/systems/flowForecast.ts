/**
 * flowForecast.ts — Pure forecast → segment-state simulation for Watershed.
 *
 * Maps temperature / snowpack / dam-release inputs to hourly flow samples and
 * deterministic segment-state effects. Shared by FlowForecast UI, ChunkManager
 * (map treadmill), and ReachNormalizer so both track paths stay in sync.
 */

import {
  FLOW_FORECAST_STATES,
  type FlowForecastState,
} from '../constants/game';

// =============================================================================
// Types
// =============================================================================

export type DamReleaseEntry = { hour: number; release: number };

export type FlowForecastSample = {
  hour: number;
  flowRate: number;
  state: FlowForecastState;
};

export type RockDensityTier = 'low' | 'medium' | 'high';

/** Authored / procedural fields that forecast multipliers may rewrite. */
export type ForecastSegmentParams = {
  type: string;
  width: number;
  waterWidth: number;
  flowSpeed: number;
  particleCount: number;
  rockDensity: RockDensityTier | string;
  cameraShake?: number;
  /** Optional authored bridge/gap; WashedOut forces a gap when present or flagged. */
  hasBridge?: boolean;
  washedOutGap?: boolean;
};

export type ForecastSegmentEffects = {
  state: FlowForecastState;
  widthMult: number;
  waterWidthMult: number;
  flowSpeedMult: number;
  particleCountMult: number;
  rockDensityBump: number;
  cameraShakeAdd: number;
  /** Extra slipperiness 0–1 layered on authored ice/biome slip. */
  slipperinessAdd: number;
  /** Wall friction scale relative to biome wallFriction. */
  wallFrictionMult: number;
  /** Force type override (e.g. Flooded normal → pond). */
  typeOverride: string | null;
  /** Disable bridges / open authored gaps. */
  washedOutGap: boolean;
  /** Survive-this-state score bonus (awarded on clean exit). */
  surviveBonus: number;
};

export type AppliedForecastParams = ForecastSegmentParams & {
  segmentState: FlowForecastState;
  washedOutGap: boolean;
  slipperinessAdd: number;
  wallFrictionMult: number;
  surviveBonus: number;
};

// =============================================================================
// Thresholds & effect tables (single source of truth)
// =============================================================================

export const FLOW_RATE_THRESHOLDS = {
  HIGH_FLOW: 1.05,
  FLOODED: 1.35,
  WASHED_OUT: 1.65,
} as const;

/** Next-N strip length for the forecast HUD (segments ahead). */
export const FORECAST_HUD_LOOKAHEAD = 8;

export const FORECAST_EFFECTS: Record<FlowForecastState, ForecastSegmentEffects> = {
  [FLOW_FORECAST_STATES.NORMAL]: {
    state: FLOW_FORECAST_STATES.NORMAL,
    widthMult: 1,
    waterWidthMult: 1,
    flowSpeedMult: 1,
    particleCountMult: 1,
    rockDensityBump: 0,
    cameraShakeAdd: 0,
    slipperinessAdd: 0,
    wallFrictionMult: 1,
    typeOverride: null,
    washedOutGap: false,
    surviveBonus: 0,
  },
  [FLOW_FORECAST_STATES.HIGH_FLOW]: {
    state: FLOW_FORECAST_STATES.HIGH_FLOW,
    widthMult: 1.12,
    waterWidthMult: 1.15,
    flowSpeedMult: 1.2,
    particleCountMult: 1.4,
    rockDensityBump: 1,
    cameraShakeAdd: 0.05,
    slipperinessAdd: 0.08,
    wallFrictionMult: 0.8,
    typeOverride: null,
    washedOutGap: false,
    surviveBonus: 150,
  },
  [FLOW_FORECAST_STATES.FLOODED]: {
    state: FLOW_FORECAST_STATES.FLOODED,
    widthMult: 1.3,
    waterWidthMult: 1.4,
    flowSpeedMult: 1.45,
    particleCountMult: 2.0,
    rockDensityBump: 1,
    cameraShakeAdd: 0.12,
    slipperinessAdd: 0.18,
    wallFrictionMult: 0.55,
    typeOverride: 'pond',
    washedOutGap: false,
    surviveBonus: 400,
  },
  [FLOW_FORECAST_STATES.WASHED_OUT]: {
    state: FLOW_FORECAST_STATES.WASHED_OUT,
    widthMult: 1.4,
    waterWidthMult: 1.55,
    flowSpeedMult: 1.7,
    particleCountMult: 2.4,
    rockDensityBump: 2,
    cameraShakeAdd: 0.2,
    slipperinessAdd: 0.25,
    wallFrictionMult: 0.4,
    typeOverride: 'pond',
    washedOutGap: true,
    surviveBonus: 750,
  },
};

const ROCK_DENSITY_ORDER: RockDensityTier[] = ['low', 'medium', 'high'];

// =============================================================================
// Pure simulation
// =============================================================================

export function computeFlowRate(
  hour: number,
  temperature: number,
  snowpackIndex: number,
  damReleaseSchedule: ReadonlyArray<DamReleaseEntry> = [],
): number {
  const diurnal = 0.85 + Math.max(0, temperature - 2) * 0.04;
  const melt = Math.max(0, temperature - 1) * snowpackIndex * 0.06;
  const damRelease = damReleaseSchedule.reduce((total, entry) => {
    return total + (Math.abs(entry.hour - hour) <= 1 ? entry.release : 0);
  }, 0);

  return Math.max(0.25, diurnal + melt + damRelease);
}

export function classifyFlow(flowRate: number): FlowForecastState {
  if (flowRate >= FLOW_RATE_THRESHOLDS.WASHED_OUT) return FLOW_FORECAST_STATES.WASHED_OUT;
  if (flowRate >= FLOW_RATE_THRESHOLDS.FLOODED) return FLOW_FORECAST_STATES.FLOODED;
  if (flowRate >= FLOW_RATE_THRESHOLDS.HIGH_FLOW) return FLOW_FORECAST_STATES.HIGH_FLOW;
  return FLOW_FORECAST_STATES.NORMAL;
}

export function buildForecastSamples(options: {
  temperature: number;
  snowpackIndex: number;
  damReleaseSchedule?: ReadonlyArray<DamReleaseEntry>;
  startHour?: number;
  horizonHours?: number;
}): FlowForecastSample[] {
  const {
    temperature,
    snowpackIndex,
    damReleaseSchedule = [],
    startHour = 0,
    horizonHours = 24,
  } = options;

  const samples: FlowForecastSample[] = [];
  for (let offset = 0; offset < horizonHours; offset += 1) {
    const hour = startHour + offset;
    const flowRate = computeFlowRate(hour, temperature, snowpackIndex, damReleaseSchedule);
    samples.push({
      hour,
      flowRate,
      state: classifyFlow(flowRate),
    });
  }
  return samples;
}

export function getForecastEffects(state: string): ForecastSegmentEffects {
  if (state === FLOW_FORECAST_STATES.WASHED_OUT) return FORECAST_EFFECTS[FLOW_FORECAST_STATES.WASHED_OUT];
  if (state === FLOW_FORECAST_STATES.FLOODED) return FORECAST_EFFECTS[FLOW_FORECAST_STATES.FLOODED];
  if (state === FLOW_FORECAST_STATES.HIGH_FLOW) return FORECAST_EFFECTS[FLOW_FORECAST_STATES.HIGH_FLOW];
  return FORECAST_EFFECTS[FLOW_FORECAST_STATES.NORMAL];
}

export function bumpRockDensity(
  density: RockDensityTier | string,
  bump: number,
): RockDensityTier {
  const normalized: RockDensityTier =
    density === 'high' || density === 'medium' || density === 'low' ? density : 'medium';
  if (bump <= 0) return normalized;
  const idx = Math.min(ROCK_DENSITY_ORDER.length - 1, ROCK_DENSITY_ORDER.indexOf(normalized) + bump);
  return ROCK_DENSITY_ORDER[idx];
}

/**
 * Apply forecast state multipliers to base segment params.
 * Pure and deterministic — used by ChunkManager and ReachNormalizer alike.
 */
export function applyForecastToSegmentParams(
  base: ForecastSegmentParams,
  state: string,
): AppliedForecastParams {
  const effects = getForecastEffects(state);
  const type =
    effects.typeOverride && base.type === 'normal'
      ? effects.typeOverride
      : base.type;

  // WashedOut always opens a gap; authored hasBridge + WashedOut also forces it.
  const washedOutGap =
    Boolean(base.washedOutGap) ||
    effects.washedOutGap ||
    (effects.state === FLOW_FORECAST_STATES.WASHED_OUT && Boolean(base.hasBridge));

  return {
    ...base,
    type,
    width: base.width * effects.widthMult,
    waterWidth: base.waterWidth * effects.waterWidthMult,
    flowSpeed: base.flowSpeed * effects.flowSpeedMult,
    particleCount: Math.round(base.particleCount * effects.particleCountMult),
    rockDensity: bumpRockDensity(base.rockDensity, effects.rockDensityBump),
    cameraShake: (base.cameraShake ?? 0) + effects.cameraShakeAdd,
    segmentState: effects.state,
    washedOutGap,
    slipperinessAdd: effects.slipperinessAdd,
    wallFrictionMult: effects.wallFrictionMult,
    surviveBonus: effects.surviveBonus,
  };
}

/** Map hourly samples → segment-index forecast states (1:1 prototype mapping). */
export function samplesToForecastByIndex(
  samples: ReadonlyArray<{ state: string }>,
): Map<number, FlowForecastState> {
  const map = new Map<number, FlowForecastState>();
  samples.forEach((sample, index) => {
    map.set(index, getForecastEffects(sample.state).state);
  });
  return map;
}

export function resolveForecastState(
  forecastByIndex: Map<number, string> | undefined,
  index: number,
  fallback: string = FLOW_FORECAST_STATES.NORMAL,
): FlowForecastState {
  const raw = forecastByIndex?.get(index) ?? fallback;
  return getForecastEffects(raw).state;
}

/**
 * Next dam-release countdown in forecast hours from `currentHour`.
 * Returns null when no future release is scheduled in the horizon.
 */
export function nextDamReleaseCountdown(
  damReleaseSchedule: ReadonlyArray<DamReleaseEntry>,
  currentHour: number,
  horizonHours = 24,
): { hour: number; release: number; hoursUntil: number } | null {
  if (!damReleaseSchedule.length) return null;

  let best: { hour: number; release: number; hoursUntil: number } | null = null;
  for (const entry of damReleaseSchedule) {
    // Normalize to the soonest occurrence at/after currentHour within horizon.
    let hoursUntil = entry.hour - currentHour;
    while (hoursUntil < 0) hoursUntil += 24;
    if (hoursUntil > horizonHours) continue;
    if (!best || hoursUntil < best.hoursUntil) {
      best = { hour: entry.hour, release: entry.release, hoursUntil };
    }
  }
  return best;
}

/** Upcoming risk strip for HUD — samples[0] is "now"/current segment. */
export function upcomingRiskStrip(
  samples: ReadonlyArray<FlowForecastSample>,
  lookahead = FORECAST_HUD_LOOKAHEAD,
): FlowForecastSample[] {
  return samples.slice(0, lookahead);
}

export function isElevatedRisk(state: string): boolean {
  return state !== FLOW_FORECAST_STATES.NORMAL;
}
