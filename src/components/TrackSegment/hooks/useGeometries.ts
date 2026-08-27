import { useEffect, useMemo } from 'react';
import type { TrackSegmentGeometries, UseGeometriesParams } from '../types';
import {
  buildCanyonGeometry,
  buildCollisionGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
  computePlungeImpactPlacement,
  computeWaterfallPos,
  type GeometryBuildContext,
} from './geometryBuilders';
import {
  createSegmentBathymetrySource,
  registerSegmentBathymetry,
  unregisterSegmentBathymetry,
} from '../../../systems/water/bathymetrySampler';

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
}: UseGeometriesParams): TrackSegmentGeometries {
  const isGlacier = biomeProfile?.id === 'glacier' || biome === 'glacier';

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
  ]);

  const canyonGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildCanyonGeometry(buildCtx);
  }, [buildCtx, pathLength]);

  const collisionGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildCollisionGeometry(buildCtx);
  }, [buildCtx, pathLength]);

  const wallShellGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildWallShellGeometry(buildCtx);
  }, [buildCtx, pathLength, biomeProfile.wallHeight]);

  const waterGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildWaterGeometry(buildCtx);
  }, [buildCtx, pathLength]);

  // #374 Phase 2: publish this segment's canyon floor so the SWE grid can
  // sample a real bed instead of stepping over zeros. Keyed by segment ID, so
  // a recycled treadmill slot replaces its own entry.
  useEffect(() => {
    if (!buildCtx) {
      unregisterSegmentBathymetry(segmentId);
      return;
    }
    registerSegmentBathymetry(segmentId, createSegmentBathymetrySource(buildCtx));
    return () => unregisterSegmentBathymetry(segmentId);
  }, [buildCtx, segmentId, pathLength]);

  const waterfallPos = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computeWaterfallPos(segmentPath, type, segmentId);
  }, [type, segmentPath, active, segmentId]);

  const plungeImpactPlacement = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computePlungeImpactPlacement(segmentPath, type, waterfallPos, waterWidth, segmentId);
  }, [active, segmentId, segmentPath, type, waterfallPos, waterWidth]);

  return {
    canyonGeometry,
    collisionGeometry,
    wallShellGeometry,
    waterGeometry,
    waterfallPos,
    plungeImpactPlacement,
  };
}
