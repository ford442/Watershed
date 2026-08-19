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
  ultra: {
    enabled: true,
    width: 64,
    height: 40,
    cellSize: 0.5,
    stepHz: 60,
    displacementScale: 0.26,
  },
};

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
