/**
 * sweBedGuard — the bed is finite before any solver reads it (#575).
 *
 * The SWE lift purges a non-finite η, u or w every step, but not the bed: a
 * NaN `b` cell lifted to depth max(0, NaN) = 0 and wrote η = 0 + NaN − H back,
 * a NaN `h` on every step for as long as the bed held it. The bed is written in
 * TypeScript (the rasterizer, sweParity) and published through `commitBed()`
 * on every backend, so it is repaired once there, when it is written, rather
 * than re-checked per cell per step. A repaired cell becomes a dry bank
 * (SWE_DRY_BANK_BED, what the rasterizer writes for a non-finite floor).
 */
import { SWE_MEAN_DEPTH } from './sweQuality';

/**
 * A bed this high is a dry bank at every still depth the budgets use. The
 * rasterizer writes it for a non-finite floor too (bathymetrySampler.ts
 * BATHYMETRY_DRY_BED is this value). Defined here, not there, so the sim
 * worker's module graph stays clear of the sampler and SWEHeightField.
 */
export const SWE_DRY_BANK_BED = SWE_MEAN_DEPTH + 2;

let repairedCells = 0;
let warned = false;

/** Replace every non-finite cell of `b` with a dry bank; returns how many were replaced. */
export function sanitizeBed(b: Float32Array): number {
  let repaired = 0;
  for (let i = 0; i < b.length; i += 1) {
    if (!Number.isFinite(b[i])) {
      b[i] = SWE_DRY_BANK_BED;
      repaired += 1;
    }
  }
  if (repaired > 0) {
    repairedCells += repaired;
    if (import.meta.env.DEV && !warned) {
      warned = true;
      console.warn(`[swe] commitBed repaired ${repaired} non-finite bed cell(s) to a dry bank`);
    }
  }
  return repaired;
}

/** Non-finite bed cells repaired this session, every backend (the HUD bed snapshot reports it). */
export function sweBedRepairCount(): number {
  return repairedCells;
}
