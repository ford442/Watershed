import React, { useMemo } from 'react';
import * as THREE from 'three';
import { WATER_LEVEL } from '../../constants/game';
import { getTrackBiomeProfile } from '../../configs/TrackBiomes';
import { smoothNoise } from './utils';

import { usePlacementData } from './hooks/usePlacementData';
import { useGeometries } from './hooks/useGeometries';
import { TrackSegmentMeshes } from './TrackSegmentMeshes';

export default function TrackSegment({
    segmentId,
    type = 'normal', // 'normal', 'waterfall', 'splash', 'pond'
    segmentPath,
    width = 28,
    waterWidth: waterWidthOverride,
    active = true,
    rockMaterial,
    biome = 'summer',
    waterMaterial,
    flowSpeed = 1.0,
    config = {},
    showDebug = false,
    waterLevel = WATER_LEVEL,
    segmentState = 'Normal',
    particleCount,
    particleDensity,
    raftRef,
    isNight = false,
    flowMap,
    verticalBias = 0,
    weatherWetnessRef,
    usePooledStaticObstacles = false,
}) {
    const biomeProfile = useMemo(() => getTrackBiomeProfile(biome), [biome]);

    const pathLength = useMemo(() => {
        if (!segmentPath) return 0;
        return segmentPath.getLength();
    }, [segmentPath]);

    const canyonWidth = biomeProfile.id === 'slotCanyon' ? biomeProfile.canyonWidth : width;
    const waterWidth = waterWidthOverride ?? (type === 'pond' ? Math.max(45, biomeProfile.waterWidth) : biomeProfile.waterWidth);
    const isSlotCanyon = biomeProfile.id === 'slotCanyon';

    const channelProfile = useMemo(() => {
        if (!active || !segmentPath || pathLength <= 0) return [];

        const sampleCount = Math.max(8, Math.floor(pathLength / 2));
        const corridorHalfWidth = Math.max(3.2, Math.min(waterWidth * 0.35, waterWidth * 0.5 - 1.2));
        const widthAmplitude = type === 'pond' ? 0.06 : isSlotCanyon ? 0.12 : 0.18;
        const asymmetryAmplitude = isSlotCanyon ? 0.22 : 0.14;

        return Array.from({ length: sampleCount + 1 }, (_, index) => {
            const t = sampleCount === 0 ? 0 : index / sampleCount;
            const worldArc = segmentId + t;
            const baseWidth = waterWidth * 0.5;
            const widthNoise = smoothNoise(worldArc * 2.1 + 0.17) * 0.6 + smoothNoise(worldArc * 4.4 - 0.33) * 0.4;
            const riffleWave = Math.sin(worldArc * Math.PI * 1.35 + segmentId * 0.21);
            const riffleNoise = smoothNoise(worldArc * 3.2 + 1.7) * 0.35;
            const riffleStrength = THREE.MathUtils.clamp(riffleWave * 0.65 + riffleNoise, -1, 1);
            const poolDepth = THREE.MathUtils.clamp(Math.max(0, -riffleStrength), 0, 1);
            const riffleAmount = THREE.MathUtils.clamp(Math.max(0, riffleStrength), 0, 1);
            const widthScale = 1 + widthNoise * widthAmplitude + poolDepth * 0.16 - riffleAmount * 0.1;
            const asymmetry = smoothNoise(worldArc * 1.5 - 2.4) * asymmetryAmplitude;
            const leftHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 + asymmetry));
            const rightHalfWidth = Math.max(corridorHalfWidth + 0.8, baseWidth * widthScale * (1 - asymmetry));
            const floorDepth = poolDepth * (isSlotCanyon ? 1.4 : 1.1) - riffleAmount * 0.35;
            const floorWave = smoothNoise(worldArc * 6.4 + 0.8) * 0.18 + Math.sin(worldArc * Math.PI * 3.1) * 0.08;

            return {
                t,
                worldArc,
                leftHalfWidth,
                rightHalfWidth,
                corridorHalfWidth,
                floorDepth,
                floorWave,
                riffleStrength,
                gravelBarSide: asymmetry > 0 ? 1 : -1,
                undercutSide: asymmetry > 0 ? -1 : 1,
                flowScale: 1 + riffleAmount * 0.18 - poolDepth * 0.12,
            };
        });
    }, [active, segmentId, segmentPath, pathLength, waterWidth, type, isSlotCanyon]);

    const placementData = usePlacementData({
        active, segmentPath, segmentId, type, pathLength,
        waterWidth, canyonWidth, biome, config, channelProfile,
        bankStartOverride: undefined, flowSpeed, biomeProfile,
    });

    const { canyonGeometry, wallShellGeometry, waterGeometry, waterfallPos, plungeImpactPlacement } = useGeometries({
        active, segmentPath, pathLength, segmentId, type,
        channelProfile, biomeProfile, isSlotCanyon, placementData,
        canyonWidth, waterWidth, biome,
    });

    if (!active || !rockMaterial || !canyonGeometry || !wallShellGeometry || !waterGeometry) {
        return null;
    }

    return (
        <TrackSegmentMeshes
            segmentId={segmentId}
            type={type}
            segmentPath={segmentPath}
            pathLength={pathLength}
            canyonWidth={canyonWidth}
            waterWidth={waterWidth}
            active={active}
            rockMaterial={rockMaterial}
            biome={biome}
            waterMaterial={waterMaterial}
            flowSpeed={flowSpeed}
            config={config}
            showDebug={showDebug}
            placementData={placementData}
            canyonGeometry={canyonGeometry}
            wallShellGeometry={wallShellGeometry}
            waterGeometry={waterGeometry}
            waterfallPos={waterfallPos}
            plungeImpactPlacement={plungeImpactPlacement}
            isSlotCanyon={isSlotCanyon}
            waterLevel={waterLevel}
            segmentState={segmentState}
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
