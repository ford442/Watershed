/**
 * gameplayProfile.ts — what a segment does to the player, apart from how it
 * looks (#521 B).
 *
 * A biome palette (configs/palettes/) is colour grading: it cross-fades over a
 * couple of seconds and nothing it holds may push the player. The forces and
 * the climate live here instead, one `GameplayProfile` per segment, resolved by
 * MapSystem (`resolveGameplayProfile`: the biome's row below, then any authored
 * `gameplay` override on the segment config), committed by ChunkManager's
 * sim-time debounce and published by the `gameplay-profile` SimCore system
 * (gameplaySimSystem.ts), which can blend a change in over sim time.
 *
 * The rows reproduce what each field used to be read from, so no biome plays
 * differently:
 *   - `flowCap`     the palette's `flowSpeed` (WaterForceSystem's flow cap)
 *   - `surface`     `MATERIAL_FROM_BIOME` (contact friction + impact SFX/VFX)
 *   - `ambientTemp` survival's `BIOME_AMBIENT_TEMP` (the cold)
 *   - `windDry`     1 (survival's wind drying, unscaled)
 */
import { DEFAULT_BIOME_ID, isBiomeId, normalizeBiomeId, type BiomeId } from '../../configs/biomes';
import { lerp } from '../../math/scalar';
import { SurfaceMaterial } from '../vehicle/surfaceMaterial';

export interface GameplayProfile {
  /** Scale of the water current pushing the hull (WaterForceSystem's flow cap). */
  flowCap: number;
  /** Ground contact: Rapier friction (`MATERIAL_FRICTION`) and the impact SFX / VFX. */
  surface: SurfaceMaterial;
  /** Ambient core temperature the player drifts toward, 0–1; below 0.5 is a cold segment. */
  ambientTemp: number;
  /** Scale of survival's wind drying (1 = the speed-driven rate as tuned). */
  windDry: number;
}

/** The fields a map may override per segment (`SegmentProgressionConfig.gameplay`). */
export type GameplayProfileOverride = Partial<GameplayProfile>;

/** A cold segment: survival's exposure penalties apply (stamina, movement, paddle). */
export const COLD_AMBIENT_TEMP = 0.5;

function row(flowCap: number, surface: SurfaceMaterial, ambientTemp: number): Readonly<GameplayProfile> {
  return Object.freeze({ flowCap, surface, ambientTemp, windDry: 1 });
}

/** One row per biome; a new BiomeId does not compile without one. */
export const BIOME_GAMEPLAY_PROFILES: Readonly<Record<BiomeId, Readonly<GameplayProfile>>> = {
  canyonSummer: row(1.0, SurfaceMaterial.ROCK, 0.88),
  canyonAutumn: row(0.9, SurfaceMaterial.MOSS, 0.78),
  slotCanyon: row(1.1, SurfaceMaterial.CONCRETE, 0.82),
  glacialMelt: row(1.85, SurfaceMaterial.ROCK, 0.42),
  glacier: row(1.4, SurfaceMaterial.ROCK, 0.35),
  delta: row(0.28, SurfaceMaterial.MOSS, 0.9),
  alpineSpring: row(1.2, SurfaceMaterial.ROCK, 0.72),
  cavern: row(0.6, SurfaceMaterial.ROCK, 0.55),
  midnightMist: row(0.7, SurfaceMaterial.MOSS, 0.5),
  lumberFlume: row(1.55, SurfaceMaterial.WOOD, 0.7),
  hydroDam: row(1.85, SurfaceMaterial.CONCRETE, 0.65),
};

/** The biome's row (legacy aliases normalised; unknown ids read as the default biome). */
export function gameplayProfileForBiome(biome: BiomeId | string): Readonly<GameplayProfile> {
  const id = isBiomeId(biome) ? biome : normalizeBiomeId(biome);
  return BIOME_GAMEPLAY_PROFILES[id] ?? BIOME_GAMEPLAY_PROFILES[DEFAULT_BIOME_ID];
}

const SURFACES: ReadonlySet<string> = new Set(Object.values(SurfaceMaterial));

/** Authored JSON is not schema-checked for `gameplay`: only a known surface counts. */
function isSurfaceMaterial(value: unknown): value is SurfaceMaterial {
  return typeof value === 'string' && SURFACES.has(value);
}

/** A finite number from an override, else the base value. */
function pick(override: number | undefined, base: number): number {
  return typeof override === 'number' && Number.isFinite(override) ? override : base;
}

/**
 * A segment's profile: its biome's row with the authored override laid over
 * it. Returns the shared (frozen) row when there is nothing to override.
 */
export function composeGameplayProfile(
  biome: BiomeId | string,
  override?: GameplayProfileOverride | null,
): Readonly<GameplayProfile> {
  const base = gameplayProfileForBiome(biome);
  if (!override) return base;
  return Object.freeze({
    flowCap: pick(override.flowCap, base.flowCap),
    surface: isSurfaceMaterial(override.surface) ? override.surface : base.surface,
    ambientTemp: pick(override.ambientTemp, base.ambientTemp),
    windDry: pick(override.windDry, base.windDry),
  });
}

export function createGameplayProfile(from: Readonly<GameplayProfile> = gameplayProfileForBiome(DEFAULT_BIOME_ID)): GameplayProfile {
  return { flowCap: from.flowCap, surface: from.surface, ambientTemp: from.ambientTemp, windDry: from.windDry };
}

export function copyGameplayProfile(out: GameplayProfile, from: Readonly<GameplayProfile>): GameplayProfile {
  out.flowCap = from.flowCap;
  out.surface = from.surface;
  out.ambientTemp = from.ambientTemp;
  out.windDry = from.windDry;
  return out;
}

/**
 * `out` = a → b at `t` (0..1). The numbers lerp; the surface is discrete and
 * takes b's from the first moment of the blend (the ground under the feet is
 * the new segment's as soon as the player is on it).
 */
export function blendGameplayProfiles(
  out: GameplayProfile,
  a: Readonly<GameplayProfile>,
  b: Readonly<GameplayProfile>,
  t: number,
): GameplayProfile {
  out.flowCap = lerp(a.flowCap, b.flowCap, t);
  out.ambientTemp = lerp(a.ambientTemp, b.ambientTemp, t);
  out.windDry = lerp(a.windDry, b.windDry, t);
  out.surface = b.surface;
  return out;
}

export function gameplayProfilesEqual(a: Readonly<GameplayProfile>, b: Readonly<GameplayProfile>): boolean {
  return (
    a.flowCap === b.flowCap &&
    a.surface === b.surface &&
    a.ambientTemp === b.ambientTemp &&
    a.windDry === b.windDry
  );
}
