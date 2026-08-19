/**
 * surfaceFriction.ts — Segment surface friction resolution (pure).
 *
 * OWNERSHIP (read before tuning — these two systems must not double-count):
 *
 *   - **Rapier contact friction (this module)** owns *solid contact*: the runner's
 *     feet on the canyon floor, hull scrapes along the walls. It is what makes an
 *     ice chute feel like ice when you touch it.
 *   - **`WaterFlowForces`** owns *water-borne lateral drag*: how hard the current
 *     resists a sideways move while you are floating. It applies its own
 *     `slipperiness` attenuation (lateral drag × (1 − slip × 0.8) plus a downstream
 *     slide bias).
 *
 * They act on disjoint interactions — contact vs fluid — so both may read the same
 * `slipperiness` without stacking. What must NOT happen is a second contact-friction
 * scaler somewhere else, or a fluid-drag term added here.
 *
 * Consumed by `TrackSegmentMeshes` for the collision trimesh. Closes the
 * "wire slipperiness into Rapier" TODO in MapSystem.types.ts / LEVEL_DESIGN.md.
 */

/** Friction of a fully frictionless (slipperiness = 1) surface. Never exactly 0 —
 *  Rapier bodies with zero friction can slide forever and jitter against walls. */
export const ICE_MIN_FRICTION = 0.04;

/**
 * Flood-state friction floors, applied before slipperiness. Wet rock and washed-out
 * debris are already slick; these mirror the values TrackSegmentMeshes shipped with.
 */
export const FORECAST_FRICTION: Record<string, number> = {
  WashedOut: 0.35,
  Flooded: 0.55,
  HighFlow: 0.8,
};

export interface SegmentFrictionInput {
  /** Biome contact friction (`biomeProfile.wallFriction`). */
  baseFriction: number;
  /** Authored surface slipperiness 0–1 (+ forecast `slipperinessAdd`). */
  slipperiness?: number;
  /** FlowForecast segment state ('Normal' | 'HighFlow' | 'Flooded' | 'WashedOut'). */
  segmentState?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Flood-state override for this segment, or null when the state is normal. */
export function forecastFrictionOverride(segmentState?: string): number | null {
  if (!segmentState) return null;
  const override = FORECAST_FRICTION[segmentState];
  return override === undefined ? null : override;
}

/**
 * Resolve the Rapier contact friction for a segment's collision mesh.
 *
 * Order: flood state sets the baseline (wet rock overrides the biome), then
 * slipperiness interpolates that baseline toward `ICE_MIN_FRICTION`.
 *
 * Slipperiness is monotonic downward by construction — it can only ever make a
 * surface slicker, never grippier, so authoring ice on a flooded segment can't
 * accidentally hand the player back their grip.
 */
export function resolveSegmentFriction(input: SegmentFrictionInput): number {
  const base = Number.isFinite(input.baseFriction) ? input.baseFriction : 1;
  const flooded = forecastFrictionOverride(input.segmentState);
  const baseline = flooded ?? base;
  const slip = clamp01(input.slipperiness ?? 0);
  if (slip <= 0) return baseline;
  return baseline + (ICE_MIN_FRICTION - baseline) * slip;
}

/**
 * Restitution for a segment's collision mesh. Ice is glassier than rock, so a
 * slippery surface also nudges bounce up slightly — the chute should skip the
 * player along a wall rather than stopping them dead.
 */
export function resolveSegmentRestitution(
  baseRestitution: number,
  slipperiness?: number,
): number {
  const slip = clamp01(slipperiness ?? 0);
  return baseRestitution + (0.25 - baseRestitution) * slip * 0.5;
}
