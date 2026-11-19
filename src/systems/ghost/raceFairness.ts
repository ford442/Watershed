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
import { getActiveConditions, getActiveLaunchHour, runConditionsFairnessKey } from '../journey/runSession';
import { getQualityPresetNow } from '../GameState';
import { parseHydroEvents, type HydroEvent } from '../water/hydroEvents';
import { hazardsFairnessPart } from '../hazards/hazardFairness';
import { getActiveUserRiver, userRiverFairnessPart } from '../map/userRiverSession';
import { getRivalGhost, getRunBest } from '../persistence/PersistenceSystem';
import { getRunAssistBits } from '../settings/accessRuntime';
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
    // A player's river runs its own events over the backing map id.
    const river = getActiveUserRiver();
    return parseHydroEvents((river ? river.level : getMapDefinition(mapId)?.levelData)?.hydroEvents);
  } catch {
    return [];
  }
}

/** The raw `hazards[]` the run on `mapId` carries (a player's river carries its own). */
function hazardsForMap(mapId: MapRegistryId): unknown {
  try {
    const river = getActiveUserRiver();
    return (river ? river.level : getMapDefinition(mapId)?.levelData)?.hazards;
  } catch {
    return undefined;
  }
}

/** Fairness triple for the run being played right now. */
export function currentRunFairness(mapId: MapRegistryId = getActiveMapId()): GhostHydroFairness {
  const launchHour = getActiveLaunchHour();
  const events = hydroEventsForMap(mapId);
  const key = withPart(
    withPart(runConditionsFairnessKey(getActiveConditions()), userRiverFairnessPart()),
    // The hazards live at this hour change the river (#578 A); '' when none is.
    hazardsFairnessPart(hazardsForMap(mapId), events, launchHour),
  );
  return buildGhostHydroFairness({
    launchHour,
    events,
    qualityPreset: getQualityPresetNow(),
    conditionsKey: key,
    assists: getRunAssistBits(),
  });
}

/**
 * Append one part of the river's identity to the conditions key: a player
 * river's level hash (another river never races this one), the live hazards.
 */
function withPart(conditionsKey: string, part: string | null | undefined): string {
  if (!part) return conditionsKey;
  return conditionsKey ? `${conditionsKey}|${part}` : part;
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
    // The PB lives under this run's key, which carries the assists tag: same assists.
    { launchHour: pb.launchHour, hydroEventHash: pb.hydroEventHash, assists: getRunAssistBits() },
    'PB',
  );
}
