import { useEffect, useMemo, useState } from 'react';
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
import { buildSegmentMeshBuffers, segmentMeshSpec } from '../../../terrain/segmentMeshBuild';

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
  const meshes = workerMeshes ?? mainMeshes;

  const canyonGeometry = useMemo(() => geometryFromBuffers(meshes?.canyon ?? null), [meshes]);
  const collisionGeometry = useMemo(() => geometryFromBuffers(meshes?.collision ?? null), [meshes]);
  const wallShellGeometry = useMemo(() => geometryFromBuffers(meshes?.wallShell ?? null), [meshes]);
  const waterGeometry = useMemo(() => geometryFromBuffers(meshes?.water ?? null), [meshes]);

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
