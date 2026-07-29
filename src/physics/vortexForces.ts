/**
 * vortexForces.ts — Pure centripetal / swirl / downward suction math.
 *
 * Shared by VortexForceSystem (runtime) and unit tests. No Three.js / Rapier
 * imports so Vitest can exercise the funnel model without WASM.
 */

import type { FlowForecastState } from '../constants/game';
import { FLOW_FORECAST_STATES } from '../constants/game';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Authored + runtime vortex field parameters. */
export interface VortexForceConfig {
  /** Outer influence radius (world units, horizontal). */
  radius: number;
  /** Inner eye where radial pull softens. */
  eyeRadius: number;
  /** Inward horizontal pull magnitude. */
  pullStrength: number;
  /** Tangential swirl multiplier applied on top of pull. */
  spinStrength: number;
  /** Downward suction toward the drain throat. */
  downwardForce: number;
}

export interface VortexForceResult {
  force: Vec3Like;
  torque: Vec3Like;
  /** True when body is inside the horizontal radius. */
  inside: boolean;
  /** Horizontal distance to vortex center. */
  dist: number;
}

const ZERO: Vec3Like = { x: 0, y: 0, z: 0 };

export const DEFAULT_VORTEX_CONFIG: VortexForceConfig = {
  radius: 10,
  eyeRadius: 2.2,
  pullStrength: 50,
  spinStrength: 2.2,
  downwardForce: 10,
};

/**
 * Forecast gate multiplier — high dam-release / flood states pull harder.
 * Low / Normal hours leave a weaker field so a portage ledge stays viable.
 */
export function vortexStrengthMultiplier(state: string | FlowForecastState): number {
  switch (state) {
    case FLOW_FORECAST_STATES.WASHED_OUT:
      return 1.55;
    case FLOW_FORECAST_STATES.FLOODED:
      return 1.25;
    case FLOW_FORECAST_STATES.HIGH_FLOW:
      return 1.1;
    case FLOW_FORECAST_STATES.NORMAL:
    default:
      return 0.85;
  }
}

/**
 * Continuous fine-scale from raw flowRate so low vs high dam-release hours
 * differ even when both classify as the same discrete state.
 */
export function vortexStrengthFromFlowRate(flowRate: number): number {
  const clamped = Math.max(0.5, Math.min(2.4, flowRate));
  return 0.7 + (clamped - 0.5) * 0.45;
}

/** Combined gate strength used by VortexForceSystem. */
export function effectiveVortexStrength(
  forecastState: string | FlowForecastState,
  flowRate?: number,
): number {
  const stateMult = vortexStrengthMultiplier(forecastState);
  if (typeof flowRate !== 'number' || !Number.isFinite(flowRate)) return stateMult;
  return stateMult * vortexStrengthFromFlowRate(flowRate);
}

/**
 * Catwalks / gates wash out on peak release (WashedOut).
 * Flooded keeps the ledge so low-release runs still have a portage option.
 */
export function shouldWashOutCatwalk(
  forecastState: string | FlowForecastState,
  hasBridge: boolean,
): boolean {
  return hasBridge && forecastState === FLOW_FORECAST_STATES.WASHED_OUT;
}

/**
 * Compute centripetal pull + swirl + downward suction for one body sample.
 * Horizontal distance drives the funnel; Y is ignored for radius tests so a
 * bobbing raft stays in the field.
 */
export function computeVortexForces(
  bodyPos: Vec3Like,
  center: Vec3Like,
  config: VortexForceConfig,
  strengthMult = 1,
): VortexForceResult {
  const radius = Math.max(config.radius, 0.01);
  const eyeRadius = Math.max(0, Math.min(config.eyeRadius, radius * 0.95));

  const dx = center.x - bodyPos.x;
  const dz = center.z - bodyPos.z;
  const dist = Math.hypot(dx, dz);

  if (dist > radius || !Number.isFinite(dist)) {
    return { force: { ...ZERO }, torque: { ...ZERO }, inside: false, dist };
  }

  const inv = dist > 1e-5 ? 1 / dist : 0;
  const nx = dx * inv;
  const nz = dz * inv;

  // Strongest near the rim, softens in the eye — classic funnel feel.
  const rimSpan = Math.max(radius - eyeRadius, 1e-5);
  const distFactor = Math.max(0, (dist - eyeRadius) / rimSpan);
  const pull = config.pullStrength * strengthMult * distFactor * distFactor;

  // Tangential swirl (perpendicular to inward on XZ).
  const tangentX = -nz;
  const tangentZ = nx;
  const spin = pull * config.spinStrength;

  // Downward suction ramps up toward the eye / drain throat.
  const eyeFactor = 1 - distFactor;
  const down = config.downwardForce * strengthMult * (0.3 + 0.7 * eyeFactor);

  return {
    force: {
      x: nx * pull + tangentX * spin * 0.35,
      y: -down,
      z: nz * pull + tangentZ * spin * 0.35,
    },
    torque: {
      x: 0,
      y: spin * 0.22,
      z: 0,
    },
    inside: true,
    dist,
  };
}

/** Resolve authored JSON / defaults into a concrete force config. */
export function resolveVortexConfig(
  partial?: Partial<VortexForceConfig> | null,
): VortexForceConfig {
  return {
    ...DEFAULT_VORTEX_CONFIG,
    ...(partial ?? {}),
  };
}
