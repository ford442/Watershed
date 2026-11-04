import React, { useEffect, useMemo } from 'react';
import { WATER_LEVEL } from '../../constants/game';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { normalizeBiomeId, type BiomeId } from '../../configs/biomes';
import { buildChannelProfile } from './channelProfile';
import type { ChannelProfileSample, SegmentKind, TrackSegmentProps } from './types';

import { usePlacementData, usePlacementInput } from './hooks/usePlacementData';
import { useGeometries } from './hooks/useGeometries';
import { TrackSegmentMeshes } from './TrackSegmentMeshes';
import { noteSegmentBuilt, noteSegmentMounted, spawnTimingStart } from '../../terrain/spawnTiming';

export default function TrackSegment({
  segmentId = 0,
  type = 'normal',
  segmentPath,
  width = 28,
  waterWidth: waterWidthOverride,
  active = true,
  rockMaterial,
  biome = 'canyonSummer',
  waterMaterial,
  flowSpeed = 1.0,
  config = {},
  showDebug = false,
  waterLevel = WATER_LEVEL,
  segmentState = 'Normal',
  slipperiness = 0,
  particleCount,
  particleDensity,
  raftRef,
  isNight = false,
  flowMap,
  verticalBias = 0,
  weatherWetnessRef,
  usePooledStaticObstacles = false,
  buildAhead = false,
}: TrackSegmentProps) {
  const spawnStart = spawnTimingStart();
  const biomeId: BiomeId = typeof biome === 'string' ? normalizeBiomeId(biome) : biome;
  const biomeProfile = useMemo(() => getTrackBiomeProfile(biomeId), [biomeId]);
  const segmentType = type as SegmentKind;

  const pathLength = useMemo(() => {
    if (!segmentPath) return 0;
    return segmentPath.getLength();
  }, [segmentPath]);

  const canyonWidth = biomeProfile.id === 'slotCanyon' ? biomeProfile.canyonWidth : width;
  const waterWidth =
    waterWidthOverride ??
    (segmentType === 'pond' ? Math.max(45, biomeProfile.waterWidth) : biomeProfile.waterWidth);
  const isSlotCanyon = biomeProfile.id === 'slotCanyon';

  const channelProfile = useMemo(
    (): ChannelProfileSample[] =>
      !active || !segmentPath ? [] : buildChannelProfile({ segmentId, pathLength, waterWidth, segmentType, isSlotCanyon }),
    [active, segmentId, segmentPath, pathLength, waterWidth, segmentType, isSlotCanyon],
  );

  const placementInput = usePlacementInput({ type: segmentType, biome: biomeId, biomeProfile, config, flowSpeed });

  const geometryStart = spawnTimingStart();
  const {
    source: geometrySource,
    placements,
    canyonGeometry,
    collisionGeometry,
    wallShellGeometry,
    waterGeometry,
    waterfallPos,
    plungeImpactPlacement,
  } = useGeometries({
    active,
    segmentPath,
    pathLength,
    segmentId,
    type: segmentType,
    channelProfile,
    biomeProfile,
    isSlotCanyon,
    placementInput,
    canyonWidth,
    waterWidth,
    biome: biomeId,
    buildAhead,
  });
  const placementData = usePlacementData(placements, { segmentId, type: segmentType, biome: biomeId, biomeProfile });

  // #487 B spawn profile (no-op without ?spawnProfile=1).
  if (active && canyonGeometry) {
    noteSegmentBuilt(segmentPath, spawnStart, {
      segmentId,
      biome: biomeId,
      source: geometrySource,
      geometryMs: geometryStart ? spawnTimingStart() - geometryStart : 0,
    });
  }
  useEffect(() => {
    if (active && canyonGeometry) noteSegmentMounted(segmentPath);
  }, [active, canyonGeometry, segmentPath]);

  if (
    !active ||
    !rockMaterial ||
    !canyonGeometry ||
    !collisionGeometry ||
    !wallShellGeometry ||
    !waterGeometry
  ) {
    return null;
  }

  return (
    <TrackSegmentMeshes
      segmentId={segmentId}
      type={segmentType}
      segmentPath={segmentPath}
      pathLength={pathLength}
      canyonWidth={canyonWidth}
      waterWidth={waterWidth}
      active={active}
      rockMaterial={rockMaterial}
      biome={biomeId}
      waterMaterial={waterMaterial}
      flowSpeed={flowSpeed}
      config={config}
      showDebug={showDebug}
      placementData={placementData}
      canyonGeometry={canyonGeometry}
      collisionGeometry={collisionGeometry}
      wallShellGeometry={wallShellGeometry}
      waterGeometry={waterGeometry}
      waterfallPos={waterfallPos}
      plungeImpactPlacement={plungeImpactPlacement}
      isSlotCanyon={isSlotCanyon}
      waterLevel={waterLevel}
      segmentState={segmentState}
      slipperiness={slipperiness}
      particleCount={particleCount}
      particleDensity={particleDensity}
      raftRef={raftRef}
      isNight={isNight}
      flowMap={flowMap}
      verticalBias={verticalBias}
      weatherWetnessRef={weatherWetnessRef}
      usePooledStaticObstacles={usePooledStaticObstacles}
    />
  );
}
