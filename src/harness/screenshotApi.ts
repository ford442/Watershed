/**
 * screenshotApi.ts — `window.__watershedScreenshot`, the headless harnesses'
 * handle on a run (#521 C2): teleports, the scripted stepper and its readiness,
 * splits / checksums / the ghost file, and the per-frame telemetry the
 * verification/*.mjs scripts compare.
 *
 * Fetched by `useScreenshotApi` only on a `?screenshot=1` page, so a player's
 * entry chunk carries none of it. Every member runs synchronously when called,
 * exactly as it did inline in useExperienceWorld: `stepScripted(n)` advances n
 * sim frames before it returns.
 */
import type { RefObject } from 'react';
import { PLAYER_SPAWN } from '../constants/game';
import { getRecordedSplitChecksums, getRecordedSplits } from '../systems/ghost/SplitRecorder';
import { getCurrentGhostPayload, getGhostElapsedMs } from '../systems/ghost/GhostRecorder';
import { exportGhostToJson } from '../systems/ghost/ghostExport';
import { currentRunFairness } from '../systems/ghost/raceFairness';
import { inputHub } from '../input/InputHub';
import { getScriptedSimTimeSec, isScriptedRunLive, stepScripted } from '../input/scriptedRun';
import { getSweReadiness, isSweSettled, isWaterForceSystemActive } from '../systems/water/WaterForceRegistry';
import { resolveActiveEnvelope } from '../vehicles/RunnerVehicle/hooks/runnerAirControl';
import { useGameStore, type GameStore } from '../systems/GameState';
import { getProceduralBaseSeed } from '../utils/runContext';
import { getActiveConditions, getRunMap } from '../systems/journey/runSession';
import type { TrackManagerRef } from '../components/TrackManager';
import type { MapRegistryId } from '../maps/registry';
import type { VehicleRigidBodyRef } from '../experience/types';

/** What the API reads from the world hook — the values as of the render that installed it. */
export interface ScreenshotApiContext {
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  trackManagerRef: RefObject<TrackManagerRef | null>;
  spawnPoints: GameStore['spawnPoints'];
  currentSegmentIndex: GameStore['currentSegmentIndex'];
  /** The active default map's first segment. */
  mapStartIndex: number;
  setCurrentSegmentIndex: GameStore['setCurrentSegmentIndex'];
  setRespawnSegmentIndex: GameStore['setRespawnSegmentIndex'];
}

/** Publish the API on `window`; returns the uninstall. */
export function installScreenshotApi({
  vehicleRef,
  trackManagerRef,
  spawnPoints,
  currentSegmentIndex,
  mapStartIndex,
  setCurrentSegmentIndex,
  setRespawnSegmentIndex,
}: ScreenshotApiContext): () => void {
  const api: NonNullable<Window['__watershedScreenshot']> = {
    teleportToZ: (z: number, y: number = PLAYER_SPAWN.position[1] as number) => {
      if (!vehicleRef.current) return false;
      vehicleRef.current.setTranslation({ x: 0, y, z }, true);
      vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return true;
    },
    teleportToSegment: (segmentIndex: number) => {
      if (!vehicleRef.current) return false;

      const spawn = spawnPoints[segmentIndex];
      const targetPosition = spawn
        ? { x: spawn.x, y: spawn.y + 1.5, z: spawn.z }
        : { x: 0, y: PLAYER_SPAWN.position[1], z: -segmentIndex * 95 };

      const previousIndex = currentSegmentIndex ?? mapStartIndex;
      const targetIndex = Math.max(0, Math.floor(segmentIndex));

      vehicleRef.current.setTranslation(targetPosition, true);
      vehicleRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      vehicleRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);

      setCurrentSegmentIndex(targetIndex);
      setRespawnSegmentIndex(targetIndex);

      if (trackManagerRef.current?.synthesizeSegmentEnter) {
        const startIdx = Math.max(previousIndex + 1, mapStartIndex);
        for (let i = startIdx; i <= targetIndex; i += 1) {
          trackManagerRef.current.synthesizeSegmentEnter(i);
        }
      }

      return true;
    },
    getSpawnPoints: () => ({ ...spawnPoints }),
    advanceTreadmill: () => trackManagerRef.current?.appendSegmentForHarness() ?? false,
    stepScripted: (n: number) => stepScripted(n),
    // Also wait for the SWE field to settle (a grid, or a definitive TS
    // fallback): forces sample a different field before and after, so a run
    // that went live mid-load would depend on how long the load took.
    isScriptedReady: () =>
      inputHub.hasSource('scripted') && isScriptedRunLive(vehicleRef.current) && isSweSettled(),
    getScriptedReadiness: () => ({
      scripted: inputHub.hasSource('scripted'),
      live: isScriptedRunLive(vehicleRef.current),
      swe: getSweReadiness(),
      sweActive: isWaterForceSystemActive(),
    }),
    getSplits: () => getRecordedSplits(),
    getSplitChecksums: () => getRecordedSplitChecksums(),
    getGhostFile: () => {
      const payload = getCurrentGhostPayload();
      if (!payload) return null;
      const mapId = getRunMap().id;
      return exportGhostToJson(
        mapId,
        getGhostElapsedMs(),
        payload,
        getRecordedSplits(),
        currentRunFairness(mapId as MapRegistryId),
        {
          seed: getProceduralBaseSeed(),
          vehicle: useGameStore.getState().vehicleType,
          conditions: getActiveConditions(),
        },
      );
    },
    getScriptedTelemetry: () => {
      const body = vehicleRef.current;
      const t = body?.translation();
      const game = useGameStore.getState();
      const stats = inputHub.getTickStats();
      const envelope = t ? resolveActiveEnvelope(t) : null;
      return {
        pos: t ? { x: t.x, y: t.y, z: t.z } : null,
        speed: game.currentSpeed,
        segmentIndex: game.currentSegmentIndex,
        isWipeout: game.isWipeout,
        envelope: envelope ? { segmentIndex: envelope.segmentIndex, yMin: envelope.yMin, yMax: envelope.yMax } : null,
        simTimeSec: getScriptedSimTimeSec(),
        ghostElapsedMs: getGhostElapsedMs(),
        hubTickMeanMs: stats.meanMs,
        hubTicks: stats.ticks,
        input: (() => {
          const f = inputHub.readFrame();
          return { source: f.source, moveX: f.moveX, moveY: f.moveY, lookDX: f.lookDX, lookDY: f.lookDY, buttons: f.buttons, frameIdx: f.frameIdx };
        })(),
      };
    },
  };

  window.__watershedScreenshot = api;
  return () => {
    delete window.__watershedScreenshot;
  };
}
