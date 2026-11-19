/**
 * useHazardsUp — true while any hazard is armed, telegraphing or active (#578 A).
 *
 * The page mounts the hazard telegraph (in the scene) and the HUD banner only
 * then, so a run that never meets one never fetches either chunk. Re-renders on
 * phase changes only (hazardLive's subscription), never per step.
 */
import { useSyncExternalStore } from 'react';
import { anyHazardUp, subscribeLiveHazards } from '../systems/hazards/hazardLive';

export function useHazardsUp(): boolean {
  return useSyncExternalStore(subscribeLiveHazards, anyHazardUp, anyHazardUp);
}
