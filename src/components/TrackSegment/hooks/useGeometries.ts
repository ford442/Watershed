import { useMemo } from 'react';
import type { TrackSegmentGeometries, UseGeometriesParams } from '../types';
import {
  buildCanyonGeometry,
  buildWallShellGeometry,
  buildWaterGeometry,
  computePlungeImpactPlacement,
  computeWaterfallPos,
  type GeometryBuildContext,
} from './geometryBuilders';

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

  const wallShellGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildWallShellGeometry(buildCtx);
  }, [buildCtx, pathLength, biomeProfile.wallHeight]);

  const waterGeometry = useMemo(() => {
    if (!buildCtx) return null;
    return buildWaterGeometry(buildCtx);
  }, [buildCtx, pathLength]);

  const waterfallPos = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computeWaterfallPos(segmentPath, type, segmentId);
  }, [type, segmentPath, active, segmentId]);

  const plungeImpactPlacement = useMemo(() => {
    if (!active || !segmentPath) return null;
    return computePlungeImpactPlacement(segmentPath, type, waterfallPos, waterWidth, segmentId);
  }, [active, segmentId, segmentPath, type, waterfallPos, waterWidth]);

  return { canyonGeometry, wallShellGeometry, waterGeometry, waterfallPos, plungeImpactPlacement };
}
