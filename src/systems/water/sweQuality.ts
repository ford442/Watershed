/**
 * sweQuality.ts — Quality budgets for the shallow-water (SWE) visual path.
 *
 * The SWE grid is a *visual* system: it steps a player-centred height field in
 * C++/WASM and uploads it as a DataTexture that FlowingWater displaces by. It is
 * therefore budgeted like any other renderer feature — the `low` preset turns it
 * off entirely so the frame budget holds on weak hardware, and the higher presets
 * scale grid resolution, step rate, and displacement amplitude.
 *
 * Force math is NOT gated here. Buoyancy/drag/flow are gameplay-affecting and run
 * at every quality level (see WaterForceSystem).
 *
 * Pure module — no React, no THREE, no WASM. Unit-tested in sweQuality.test.ts.
 */

import type { QualityPreset } from '../GameState';

/** Still-water depth over a zero bed (m) — the solver's `H`. */
export const SWE_MEAN_DEPTH = 1.0;

export interface SWEBudget {
  /** Whether the SWE grid steps and displaces water at all. */
  enabled: boolean;
  /** Grid columns. */
  width: number;
  /** Grid rows. */
  height: number;
  /** Cell size in metres. Larger cells cover the same area with fewer cells. */
  cellSize: number;
  /** Maximum SWE steps per second (the render loop accumulates between steps). */
  stepHz: number;
  /** Vertex displacement scale applied by the water shader. */
  displacementScale: number;
}

const DISABLED: SWEBudget = {
  enabled: false,
  width: 0,
  height: 0,
  cellSize: 0.5,
  stepHz: 0,
  displacementScale: 0,
};

/**
 * Per-preset budgets. Areas are kept roughly comparable (~24m x 16m of river)
 * so the displaced region doesn't visibly shrink when quality drops — the cell
 * count falls instead.
 */
export const SWE_BUDGETS: Record<QualityPreset, SWEBudget> = {
  low: DISABLED,
  medium: {
    enabled: true,
    width: 32,
    height: 24,
    cellSize: 0.75,
    stepHz: 30,
    displacementScale: 0.14,
  },
  high: {
    enabled: true,
    width: 48,
    height: 32,
    cellSize: 0.5,
    stepHz: 60,
    displacementScale: 0.22,
  },
  // 64 m x 40 m (#467): with the SIMD128 HLL stepper 128 x 80 fits
  // SWE_STEP_BUDGET_MS — enough for a raft wake that is still there two
  // segments later and a plunge pool the solver actually resolves.
  ultra: {
    enabled: true,
    width: 128,
    height: 80,
    cellSize: 0.5,
    stepHz: 60,
    displacementScale: 0.26,
  },
};

/**
 * Worker time one `stepShallowWater[Inflow]` may take at any preset's grid, as
 * a median over 1000 steps of the release binary (#467) — 1.8% of a 60 Hz
 * frame on the sim worker, which also runs forces, the router and particles.
 * On the 8-core dev box the pre-SIMD Ultra step (64 x 40) was 0.18 ms; the
 * SIMD128 HLL stepper runs 64 x 40 in ~0.057 ms and 128 x 80 in ~0.235 ms, so
 * the bigger Ultra window costs ~1.3x the old one. `pnpm profile:physics` (and
 * `pnpm profile:swe`) measure every enabled preset and fail above this, so a
 * bigger grid is only added once it has been measured to fit.
 */
export const SWE_STEP_BUDGET_MS = 0.3;

/** Budget for a quality preset. Unknown presets fall back to `high`. */
export function sweBudgetForQuality(quality: QualityPreset): SWEBudget {
  return SWE_BUDGETS[quality] ?? SWE_BUDGETS.high;
}

/** Cell count for a budget — what actually drives the per-step cost. */
export function sweCellCount(budget: SWEBudget): number {
  return budget.enabled ? budget.width * budget.height : 0;
}

/** Minimum seconds between SWE steps, or 0 when the budget is uncapped/off. */
export function sweStepInterval(budget: SWEBudget): number {
  return budget.enabled && budget.stepHz > 0 ? 1 / budget.stepHz : 0;
}
