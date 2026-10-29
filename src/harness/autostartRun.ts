/**
 * autostartRun.ts — what a `?replay=` / `?river=` page does once boot is ready
 * (#521 C1). Fetched by `useHarnessAutostart` only when one of those flags is
 * set, so a player's entry chunk carries none of it.
 */
import type { MapRegistryId } from '../maps/registry';
import { loadReplayPlan } from '../input/replay';
import { loadSavedRiver } from '../systems/map/userRiverImport';
import { setProceduralSeedOverride, setVehicleOverride } from '../utils/runContext';
import type { StartRun } from '../ui/useGamePhase';

export interface AutostartRequest {
  replayUrl: string | null;
  riverId: string | null;
  /** The current handleStart, read when the run actually starts. */
  start: StartRun;
  /** The menu's map as of then. */
  selectedMapId: () => MapRegistryId;
}

export async function autostartRun({ replayUrl, riverId, start, selectedMapId }: AutostartRequest): Promise<void> {
  if (replayUrl) {
    // `?replay=<ghost>`: no menu. The run starts on the ghost's own river —
    // map, hour, seed, vehicle and day — and the ghost's input track drives it
    // (InputHubTick).
    const plan = await loadReplayPlan(replayUrl);
    // loadReplayPlan has already said why a ghost cannot be replayed.
    if (!plan) return;
    if (plan.seed !== undefined) setProceduralSeedOverride(plan.seed);
    setVehicleOverride(plan.vehicle);
    start(plan.mapId, {
      launchHour: plan.launchHour,
      conditions: plan.conditions,
      placedCacheIds: [],
      journeyMode: 'single',
    });
    return;
  }
  if (riverId) {
    // `?river=<id>` (and no replay): the saved river runs over the selected
    // map (validated again on the way in — storage is the player's to edit).
    // A missing or broken one leaves the menu up.
    const userRiver = loadSavedRiver(riverId);
    if (!userRiver) {
      console.warn(`[App] ?river=${riverId}: no valid saved river by that id`);
      return;
    }
    start(selectedMapId(), { placedCacheIds: [], journeyMode: 'single', userRiver });
  }
}
