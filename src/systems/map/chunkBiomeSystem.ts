/**
 * chunkBiomeSystem — ChunkManager's biome detection as a SimCore system (#521 A).
 *
 * The 0.4 s debounce was already counted in sim seconds (`BIOME_DEBOUNCE_SEC`);
 * it now runs on the step's dt in the registry instead of on TrackManager's
 * frame delta, so the commit lands on the same step in a real frame, a replay
 * and a headless run. The commit feeds survival (cold biomes) and the water
 * flow cap, which is why it must not depend on frame timing.
 *
 * Skipped while the camera is not finite or outside the active segment's
 * envelope, as TrackManager's whole per-frame update always was.
 */
import type { SimSystem } from '../../sim/core/SimCore';
import { getLiveChunkManager } from './ChunkManager';

export const CHUNK_BIOME_SIM_ORDER = 30;

export function createChunkBiomeSimSystem(): SimSystem {
  return {
    id: 'chunk-biome',
    order: CHUNK_BIOME_SIM_ORDER,
    step(ctx, dt) {
      if (!ctx.camera.sane) return;
      getLiveChunkManager()?.detectBiome(ctx.camera.z, dt);
    },
  };
}
