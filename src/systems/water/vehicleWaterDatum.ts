/**
 * vehicleWaterDatum — the vehicle's water level, one number per frame (#487 C).
 *
 * The force half (waterForceBridge.ts) samples the staged surface over the
 * vehicle: the covering segment's sheet plus the SWE stage offset. That same
 * number is what the raft's `isFloating` / tipping logic compares the hull to,
 * so a hydroEvent that lowers the stage grounds the hull and the tipping check
 * in the same frame. Null when no segment covers the vehicle (or before the
 * first force frame) — there is no water there to float on.
 */

let level: number | null = null;
let frame = 0;

/** Written once per force frame by applyWaterForces. */
export function publishVehicleWaterLevel(y: number | null): void {
  level = y !== null && Number.isFinite(y) ? y : null;
  frame += 1;
}

/** The staged water level over the vehicle as of the last force frame. */
export function getVehicleWaterLevel(): number | null {
  return level;
}

/** Bumps per publish — lets a test tell "not published" from "published null". */
export function getVehicleWaterLevelFrame(): number {
  return frame;
}

export function resetVehicleWaterLevelForTests(): void {
  level = null;
  frame = 0;
}
