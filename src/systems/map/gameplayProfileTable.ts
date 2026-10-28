/**
 * gameplayProfileTable — the per-biome gameplay table and `resolveGameplayProfile` (#521 B).
 *
 * A leaf module (configs + survival's ambient table only) so MapSystem can
 * re-export the resolver without importing the live treadmill. The live,
 * blended profile and its SimCore system are in gameplayProfile.ts.
 */
import { BIOME_IDS, DEFAULT_BIOME_ID, isBiomeId, type BiomeId } from '../../configs/biomes';
import { getBiomeAmbientTemp } from '../survival/survivalState';
import type { GameplayProfile } from './MapSystem.types';

/**
 * The flow cap per biome. These are the palettes' `flowSpeed` values as they
 * stood when the cap left the palette (#521 B) — a copy, on purpose: tuning a
 * palette no longer moves the water, and tuning this table no longer recolours.
 */
const FLOW_CAP_BY_BIOME: Record<BiomeId, number> = {
  canyonSummer: 1.0,
  canyonAutumn: 0.9,
  slotCanyon: 1.1,
  glacialMelt: 1.85,
  glacier: 1.4,
  delta: 0.28,
  alpineSpring: 1.2,
  cavern: 0.6,
  midnightMist: 0.7,
  lumberFlume: 1.55,
  hydroDam: 1.85,
};

function biomeProfile(biome: BiomeId): GameplayProfile {
  return {
    flowCap: FLOW_CAP_BY_BIOME[biome],
    friction: 1,
    cold: 1 - getBiomeAmbientTemp(biome),
    wind: 0,
    blendSec: 0,
  };
}

const PROFILE_BY_BIOME: Readonly<Record<BiomeId, Readonly<GameplayProfile>>> = Object.freeze(
  Object.fromEntries(BIOME_IDS.map((id) => [id, Object.freeze(biomeProfile(id))])) as Record<
    BiomeId,
    Readonly<GameplayProfile>
  >,
);

/**
 * The profile of a segment: its biome's row, with the authored surface
 * slipperiness (0–1, `SegmentProgressionConfig.slipperiness`) folded into the
 * grip. An unknown biome id gets the default biome's row, as the palette
 * lookup it replaces did.
 */
export function resolveGameplayProfile(biome: string, slipperiness = 0): GameplayProfile {
  const row = PROFILE_BY_BIOME[isBiomeId(biome) ? biome : DEFAULT_BIOME_ID];
  const slip = Number.isFinite(slipperiness) ? Math.min(1, Math.max(0, slipperiness)) : 0;
  return { ...row, friction: row.friction * (1 - slip) };
}
