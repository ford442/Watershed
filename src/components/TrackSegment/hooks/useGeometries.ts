import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { BufferGeometry } from 'three';
import type { TrackSegmentGeometries, UseGeometriesParams } from '../types';
import {
  computePlungeImpactPlacement,
  computeWaterfallPos,
  geometryFromBuffers,
  resolveTubeProfile,
  type GeometryBuildContext,
} from './geometryBuilders';
import {
  createSegmentBathymetrySource,
  registerSegmentBathymetry,
  unregisterSegmentBathymetry,
} from '../../../systems/water/bathymetrySampler';
import { isGlacialBiome } from '../../../configs/TrackBiomes';
import { peekSimWorkerProxy } from '../../../sim/createSimWorkerProxy';
import type { SimTileResult } from '../../../sim/simWorkerProtocol';
import { buildSegmentMeshBuffers, CANYON_VISUAL_SEGMENTS_X, segmentMeshSpec } from '../../../terrain/segmentMeshBuild';
import { erodeSegmentMeshes } from '../../../terrain/erosion';
import {
  getSegmentErosion,
  getSegmentErosionVersion,
  registerSegmentErosion,
  subscribeSegmentErosion,
  unregisterSegmentErosion,
} from '../../../systems/water/erosionField';
import { getRunSession } from '../../../systems/journey/runSession';
import { ACTIVE_MAP_ID } from '../../../maps/registry';

/** Dispose a geometry once it is replaced or unmounted (eroded floors are rebuilt every few seconds). */
function useDisposeOnReplace(geometry: BufferGeometry | null): void {
  useEffect(() => () => geometry?.dispose(), [geometry]);
}

export function useGeometries({
  active,
  segmentPath,
  pathLength,
  segmentId,
  type,
  channelProfile,
  biomeProfile,
  isSlotCanyon,
  canyonWidth,
  waterWidth,
  biome,
  buildAhead = false,
}: UseGeometriesParams): TrackSegmentGeometries {
  // `glacialMelt` is the campaign's glacial map; the old literal check for
  // 'glacier' alone never matched it, so the source biome got canyon rock
  // colours and no tube.
  const isGlacier = isGlacialBiome(biome, biomeProfile);
  // Ice tube / overflow pipe cross-section (#399). Null everywhere else.
  const tubeProfile = useMemo(
    () => resolveTubeProfile({ isGlacier, biome, type, canyonWidth }),
    [isGlacier, biome, type, canyonWidth],
  );

  const buildCtx = useMemo((): GeometryBuildContext | null => {
    if (!active || !segmentPath) return null;
    return {
      segmentPath,
      segmentId,
      canyonWidth,
      waterWidth,
      biome,
      channelProfile,
      isSlotCanyon,
      isGlacier,
      biomeProfile,
      tubeProfile,
    };
  }, [
    active,
    segmentPath,
    segmentId,
    canyonWidth,
    waterWidth,
    biome,
    channelProfile,
    isSlotCanyon,
    isGlacier,
    biomeProfile,
    tubeProfile,
  ]);

  // #487 B: a segment the treadmill appends ~150 m ahead is built on the sim
  // worker (WASM tile + the same builders) and mounts when its buffers land.
  // Boot and restart pools — the ground under the player — build here,
  // synchronously, as does every session without a live sim worker.
  const tileWorker = useMemo(
    () => (buildAhead && buildCtx ? peekSimWorkerProxy() : null),
    [buildAhead, buildCtx],
  );
  const [tile, setTile] = useState<{ ctx: GeometryBuildContext; result: SimTileResult | null } | null>(null);
  useEffect(() => {
    if (!buildCtx || !tileWorker) return undefined;
    let live = true;
    void tileWorker.requestTile(segmentMeshSpec(buildCtx)).then((result) => {
      if (result?.error) console.warn(`[TrackSegment ${buildCtx.segmentId}] worker tile failed; building here`, result.error);
      if (live) setTile({ ctx: buildCtx, result });
    });
    return () => {
      live = false;
    };
  }, [buildCtx, tileWorker]);
  const workerMeshes = tile && tile.ctx === buildCtx ? tile.result?.meshes ?? null : null;
  // In flight: render nothing yet. Answered without meshes (the worker died or
  // the build threw): fall through to the main-thread build.
  const awaitingWorker = tileWorker !== null && (!tile || tile.ctx !== buildCtx);
  const source = workerMeshes ? 'worker' : 'main';

  // Main-thread build: no worker for this segment, or it answered without meshes.
  const mainMeshes = useMemo(
    () => (!buildCtx || awaitingWorker || workerMeshes ? null : buildSegmentMeshBuffers(buildCtx)),
    [buildCtx, awaitingWorker, workerMeshes, pathLength, biomeProfile.wallHeight],
  );
  const builtMeshes = workerMeshes ?? mainMeshes;

  // #487 E: the floor the river has worked. The hull grid as built registers
  // its erosion plane (loaded from the save for this map segment); the SWE
  // host integrates shear into it, and each version bump re-erodes the built
  // floor, hull and bed together — at most once every few seconds.
  const builtBed = builtMeshes?.bed ?? null;
  useEffect(() => {
    if (!builtBed) return undefined;
    const mapId = getRunSession()?.mapId ?? ACTIVE_MAP_ID;
    registerSegmentErosion(segmentId, builtBed, `${mapId}:${segmentId}`);
    return () => unregisterSegmentErosion(segmentId);
  }, [builtBed, segmentId]);
  const subscribeErosion = useCallback((listener: () => void) => subscribeSegmentErosion(segmentId, listener), [segmentId]);
  const erosionVersion = useSyncExternalStore(subscribeErosion, () => getSegmentErosionVersion(segmentId));
  const meshes = useMemo(() => {
    const entry = getSegmentErosion(segmentId);
    if (!builtMeshes || !entry || entry.bed !== builtMeshes.bed || erosionVersion === 0) return builtMeshes;
    return erodeSegmentMeshes(builtMeshes, entry.applied, CANYON_VISUAL_SEGMENTS_X);
  }, [builtMeshes, erosionVersion, segmentId]);

  const canyonGeometry = useMemo(() => geometryFromBuffers(meshes?.canyon ?? null), [meshes?.canyon]);
  const collisionGeometry = useMemo(() => geometryFromBuffers(meshes?.collision ?? null), [meshes?.collision]);
  const wallShellGeometry = useMemo(() => geometryFromBuffers(meshes?.wallShell ?? null), [meshes?.wallShell]);
  const waterGeometry = useMemo(() => geometryFromBuffers(meshes?.water ?? null), [meshes?.water]);
  useDisposeOnReplace(canyonGeometry);
  useDisposeOnReplace(collisionGeometry);
  useDisposeOnReplace(wallShellGeometry);
  useDisposeOnReplace(waterGeometry);

  // Publish this segment's hull as the SWE bed (#374 Phase 2, #487 C): the
  // grid the trimesh was built from, so bed and collider are one surface.
  // Keyed by segment ID, so a recycled treadmill slot replaces its own entry;
  // a segment still waiting on its worker tile publishes nothing yet.
  const bed = meshes?.bed ?? null;
  useEffect(() => {
    const source = createSegmentBathymetrySource(segmentId, bed);
    if (!source) {
      unregisterSegmentBathymetry(segmentId);
      return undefined;
    }
    registerSegmentBathymetry(segmentId, source);
    return () => unregisterSegmentBathymetry(segmentId);
  }, [bed, segmentId]);

  const waterfallPos = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computeWaterfallPos(segmentPath, type, segmentId);
  }, [type, segmentPath, active, segmentId]);

  const plungeImpactPlacement = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computePlungeImpactPlacement(segmentPath, type, waterfallPos, waterWidth, segmentId);
  }, [active, segmentId, segmentPath, type, waterfallPos, waterWidth]);

  return {
    source,
    canyonGeometry,
    collisionGeometry,
    wallShellGeometry,
    waterGeometry,
    waterfallPos,
    plungeImpactPlacement,
  };
}
