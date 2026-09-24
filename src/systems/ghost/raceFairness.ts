/**
 * raceFairness.ts — "which river is this run on?" for ghost gating (#438 E1).
 *
 * `hydroFairness.ts` holds the pure comparisons; this module binds them to the
 * live run (selected map's authored `hydroEvents`, launch hour, quality) so
 * PauseMenu import, GhostReplayer, the results panel and the HUD banner all
 * judge a ghost against the same fairness triple.
 *
 * Hashes the *selected* map's events (`getActiveMapId()`), not the static
 * `getActiveMap()` default — a lumber ghost must carry lumber's hash.
 */

import { getMapDefinition, type MapRegistryId } from '../../maps/registry';
import { getActiveMapId, getActiveRunKey } from '../../utils/runContext';
import { getActiveLaunchHour } from '../journey/runSession';
import { getQualityPresetNow } from '../GameState';
import { parseHydroEvents, type HydroEvent } from '../water/hydroEvents';
import { getRivalGhost, getRunBest } from '../persistence/PersistenceSystem';
import type { WsGhostFile } from './ghostExport';
import {
  buildGhostHydroFairness,
  fairnessFromGhostFile,
  judgeGhostFairness,
  type GhostFairnessVerdict,
  type GhostHydroFairness,
} from './hydroFairness';

export function hydroEventsForMap(mapId: MapRegistryId): HydroEvent[] {
  try {
    return parseHydroEvents(getMapDefinition(mapId)?.levelData.hydroEvents);
  } catch {
    return [];
  }
}

/** Fairness triple for the run being played right now. */
export function currentRunFairness(mapId: MapRegistryId = getActiveMapId()): GhostHydroFairness {
  return buildGhostHydroFairness({
    launchHour: getActiveLaunchHour(),
    events: hydroEventsForMap(mapId),
    qualityPreset: getQualityPresetNow(),
  });
}

export interface JudgedRival {
  file: WsGhostFile;
  verdict: GhostFairnessVerdict;
}

/** The stored rival for `mapId` plus whether it may be raced under current conditions. */
export function judgeStoredRival(mapId: MapRegistryId = getActiveMapId()): JudgedRival | null {
  const file = getRivalGhost(mapId);
  if (!file) return null;
  return {
    file,
    verdict: judgeGhostFairness(currentRunFairness(mapId), fairnessFromGhostFile(file), 'rival'),
  };
}

/** Whether the stored PB ghost for this map+seed may be replayed at the current hour. */
export function judgeStoredPB(mapId: MapRegistryId = getActiveMapId()): GhostFairnessVerdict | null {
  const pb = getRunBest(getActiveRunKey(mapId));
  if (!pb.ghostData) return null;
  return judgeGhostFairness(
    currentRunFairness(mapId),
    { launchHour: pb.launchHour, hydroEventHash: pb.hydroEventHash },
    'PB',
  );
}
