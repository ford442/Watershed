import { useMemo } from 'react';
import * as THREE from 'three';
import { smoothNoise, hasFiniteCoordinates, lerpValue } from '../utils';
import { WALL_WATERLINE_Y, SHADERS, WATER_LEVEL } from '../../../constants/game';
import { isAutumnLike } from '../../../configs/biomes';

export function useGeometries({
    active, segmentPath, pathLength, segmentId, type,
    channelProfile, biomeProfile, isSlotCanyon, placementData,
    canyonWidth, waterWidth, biome,
}) {
    const isGlacier = biomeProfile?.id === 'glacier' || biome === 'glacier';
    const waterLevel = WATER_LEVEL;
    const canyonGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength: ${len}`);
            return null;
        }

        const segmentsX = 40;
        const segmentsZ = Math.max(2, Math.floor(len)); // At least 2 segments

        const geo = new THREE.PlaneGeometry(canyonWidth, len, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const color = new THREE.Color();

        // Biome-based color palette for the canyon floor (richer 5-stop gradient)
        // Tuned to bridge smoothly from water-edge to dry bank
        const dryColor   = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_RIM)
                         : isGlacier    ? new THREE.Color('#c8dce8')   // pale ice-scoured granite
                         : (isAutumnLike(biome) ? new THREE.Color('#b89868') : new THREE.Color('#9a8e78'));
        const wetColor   = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_SHADOW)
                         : isGlacier    ? new THREE.Color('#2a4858')   // deep glacial shadow
                         : (isAutumnLike(biome) ? new THREE.Color('#4a3828') : new THREE.Color('#3e5038'));
        const shoreColor = isSlotCanyon ? new THREE.Color(SHADERS.SLOT_ROCK_BASE)
                         : isGlacier    ? new THREE.Color('#6a9ab0')   // submerged blue-grey stone
                         : (isAutumnLike(biome) ? new THREE.Color('#685840') : new THREE.Color('#4a5c44'));
        const mossColor  = isSlotCanyon ? new THREE.Color('#7c4a2d')
                         : isGlacier    ? new THREE.Color('#4a7888')   // glacial algae / cryoconite
                         : (isAutumnLike(biome) ? new THREE.Color('#7a6640') : new THREE.Color('#587248'));
        const bankColor  = isSlotCanyon ? new THREE.Color('#bf7444')
                         : isGlacier    ? new THREE.Color('#a0b8c8')   // frost-dusted bank gravel
                         : (isAutumnLike(biome) ? new THREE.Color('#907850') : new THREE.Color('#788860'));
        const getChannelShape = (t) => {
            if (!channelProfile.length) {
                return {
                    leftHalfWidth: waterWidth * 0.5,
                    rightHalfWidth: waterWidth * 0.5,
                    corridorHalfWidth: Math.max(3.2, waterWidth * 0.5 - 1.2),
                    floorDepth: 0,
                    floorWave: 0,
                    riffleStrength: 0,
                    gravelBarSide: 1,
                    undercutSide: -1,
                };
            }
            const scaled = THREE.MathUtils.clamp(t, 0, 1) * (channelProfile.length - 1);
            const lower = Math.floor(scaled);
            const upper = Math.min(channelProfile.length - 1, lower + 1);
            const alpha = scaled - lower;
            const from = channelProfile[lower];
            const to = channelProfile[upper];
            return {
                leftHalfWidth: lerpValue(from.leftHalfWidth, to.leftHalfWidth, alpha),
                rightHalfWidth: lerpValue(from.rightHalfWidth, to.rightHalfWidth, alpha),
                corridorHalfWidth: lerpValue(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
                floorDepth: lerpValue(from.floorDepth, to.floorDepth, alpha),
                floorWave: lerpValue(from.floorWave, to.floorWave, alpha),
                riffleStrength: lerpValue(from.riffleStrength, to.riffleStrength, alpha),
                gravelBarSide: alpha < 0.5 ? from.gravelBarSide : to.gravelBarSide,
                undercutSide: alpha < 0.5 ? from.undercutSide : to.undercutSide,
            };
        };

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const t = (zLocal + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));
            const channelShape = getChannelShape(safeT);
            const signedBankWidth = xLocal < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
            const corridorWidth = Math.max(1.2, channelShape.corridorHalfWidth);
            const distFromCenter = Math.abs(xLocal);
            const normalizedDist = distFromCenter / (canyonWidth * 0.45);
            const bankRatio = distFromCenter / Math.max(0.001, signedBankWidth);
            const gravelBarInfluence = channelShape.gravelBarSide === Math.sign(xLocal || 1) ? 1 : 0;
            const undercutInfluence = channelShape.undercutSide === Math.sign(xLocal || 1) ? 1 : 0;

            let yHeight = isSlotCanyon
                ? 22 + Math.pow(Math.max(0, normalizedDist), 1.8) * 18
                : Math.pow(Math.max(0, normalizedDist), 2.5) * 12;

            if (distFromCenter < signedBankWidth) {
                const inChannel = distFromCenter / Math.max(0.001, signedBankWidth);
                const corridorEase = THREE.MathUtils.smoothstep(inChannel, 0, 1);
                yHeight *= isSlotCanyon ? 0.18 : 0.1;
                yHeight -= channelShape.floorDepth * 1.4;
                yHeight += channelShape.floorWave * (distFromCenter < corridorWidth ? 0.2 : 0.55);
                yHeight += Math.max(0, channelShape.riffleStrength) * inChannel * 0.35;
                yHeight += Math.max(0, 1 - corridorEase) * 0.05;
            } else {
                const aboveBank = Math.max(0, bankRatio - 1);
                yHeight += aboveBank * aboveBank * 4.5 * undercutInfluence;
                yHeight -= aboveBank * 1.25 * gravelBarInfluence;
            }

            const rockNoise = Math.sin(zLocal * 0.8 + xLocal * 0.5) * 0.3 + Math.sin(zLocal * 2.5 + xLocal * 1.2) * 0.1;
            yHeight += rockNoise * (0.5 + normalizedDist);

            // GUARD: Check if getPoint returns valid result
            let point;
            try {
                point = segmentPath.getPoint(safeT);
                // Check for NaN
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    console.warn(`[TrackSegment ${segmentId}] NaN in path point at t=${safeT}`);
                    point = new THREE.Vector3(0, 0, 0); // fallback
                }
            } catch (e) {
                console.warn(`[TrackSegment ${segmentId}] Error getting path point:`, e);
                point = new THREE.Vector3(0, 0, 0);
            }

            const depthTint = THREE.MathUtils.clamp(-channelShape.floorDepth * 0.25, 0, 0.2);
            const dryness = Math.min(1.0, Math.max(0.0, (yHeight - 0.2 + depthTint) / 2.5));
            // 5-stop blend: wet → shore → moss → bank → dry for smoother waterline transition
            if (dryness < 0.20) {
                color.copy(wetColor).lerp(shoreColor, dryness / 0.20);
            } else if (dryness < 0.42) {
                color.copy(shoreColor).lerp(mossColor, (dryness - 0.20) / 0.22);
            } else if (dryness < 0.65) {
                color.copy(mossColor).lerp(bankColor, (dryness - 0.42) / 0.23);
            } else {
                color.copy(bankColor).lerp(dryColor, (dryness - 0.65) / 0.35);
            }
            // Subtle noise-based intensity variation for natural-looking surface.
            // Two frequency bands avoid obvious repetition; amplitude 0.10 keeps it gentle.
            const noiseVar = (Math.sin(zLocal * 1.3 + xLocal * 0.9) * 0.5 + 0.5) * 0.10
                + (Math.sin(zLocal * 3.1 + xLocal * 2.3) * 0.5 + 0.5) * 0.04;
            const intensity = 0.72 + 0.20 * dryness + noiseVar;
            color.multiplyScalar(intensity);
            colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;

            // GUARD: Check values before setting
            const finalX = point.x + xLocal;
            const finalY = point.y + yHeight;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, 0, 0);
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, canyonWidth, waterWidth, active, segmentId, biome, channelProfile, isSlotCanyon, isGlacier]);

    // Wall Shell Geometry
    const wallShellGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength for wall: ${len}`);
            return null;
        }

        const shellWidth = isSlotCanyon ? canyonWidth * 0.92 : canyonWidth * 1.5;
        const segmentsX = 24;
        const segmentsZ = Math.max(2, Math.floor(len / 2));

        const geo = new THREE.PlaneGeometry(shellWidth, len, segmentsX, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const vertex = new THREE.Vector3();
        const colors = new Float32Array(positions.count * 3);
        const mossMask = new Float32Array(positions.count); // Moss/lichen mask channel
        const highWaterMask = new Float32Array(positions.count); // Historical flood mark channel

        // Height bands relative to WALL_WATERLINE_Y.
        const bandPalette = isSlotCanyon
            ? {
                waterline: new THREE.Color('#2f1a12'),
                lower: new THREE.Color('#7e4123'),
                mid: new THREE.Color('#a95a32'),
                upper: new THREE.Color('#cc8353'),
                rim: new THREE.Color('#d2b08d'),
            }
            : isGlacier
            ? {
                // Ice-scoured granite: deep blue-black at waterline, frost-white at rim
                waterline: new THREE.Color('#1a2830'),
                lower: new THREE.Color('#3a5868'),
                mid: new THREE.Color('#607888'),
                upper: new THREE.Color('#8aaabb'),
                rim: new THREE.Color('#d0e8f0'),
            }
            : {
                waterline: new THREE.Color('#24170f'),
                lower: new THREE.Color('#5c3721'),
                mid: new THREE.Color('#87614b'),
                upper: new THREE.Color('#ae9173'),
                rim: new THREE.Color('#c8baa0'),
            };
        const rimGrey = new THREE.Color('#9a948b');

        for (let i = 0; i < positions.count; i++) {
            vertex.fromBufferAttribute(positions, i);
            const xLocal = vertex.x;
            const zLocal = vertex.z;
            const distFromCenter = Math.abs(xLocal);

            let yHeight = isSlotCanyon
                ? biomeProfile.wallHeight + (distFromCenter * 0.18)
                : 15 + (distFromCenter * 0.5);
            yHeight += Math.sin(zLocal * 0.1) * (isSlotCanyon ? 1.8 : 3) + Math.cos(xLocal * 0.2) * (isSlotCanyon ? 1.1 : 2);
            const strataWarp = Math.sin(zLocal * 0.14 + xLocal * 0.06 + segmentId * 0.17) * (isSlotCanyon ? 1.6 : 1.1)
                + Math.cos(zLocal * 0.22 - xLocal * 0.09) * (isSlotCanyon ? 0.8 : 0.55);

            // Vertical ribbing - hand-carved flutes left by millennia of flowing water
            const ribPhase = segmentId * 0.91;
            const ribbing = Math.sin(zLocal * (isSlotCanyon ? 0.5 : 0.38) + xLocal * 0.12 + ribPhase)
                * Math.sin(xLocal * 0.22 - ribPhase * 0.6);
            yHeight += ribbing * (isSlotCanyon ? 1.1 : 0.7);

            // Quantized strata shelves - discrete ledges/undercuts where softer rock eroded away
            const shelfRaw = Math.sin(zLocal * 0.085 + xLocal * 0.04 + segmentId * 0.21) * 0.5 + 0.5;
            const shelfSteps = isSlotCanyon ? 5.0 : 3.0;
            const shelf = Math.floor(shelfRaw * shelfSteps) / shelfSteps;
            yHeight += (shelf - 0.5) * (isSlotCanyon ? 2.2 : 1.2);

            // Height relative to waterline in wall-local coordinates.
            const localY = yHeight - 2;
            const relY = localY - WALL_WATERLINE_Y;
            const warpedRelY = relY + strataWarp;

            const c = new THREE.Color();
            if (warpedRelY < 0.5) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, -0.5, 0.5);
                c.copy(bandPalette.waterline).lerp(bandPalette.lower, blend);
            } else if (warpedRelY < 4.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 0.5, 4.0);
                c.copy(bandPalette.lower).lerp(bandPalette.mid, blend);
            } else if (warpedRelY < 12.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 4.0, 12.0);
                c.copy(bandPalette.mid).lerp(bandPalette.upper, blend * 0.25);
            } else if (warpedRelY < 18.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 12.0, 18.0);
                c.copy(bandPalette.mid).lerp(bandPalette.upper, blend);
            } else if (warpedRelY < 26.0) {
                const blend = THREE.MathUtils.smoothstep(warpedRelY, 18.0, 26.0);
                const rimTint = bandPalette.rim.clone().lerp(rimGrey, 0.3 + blend * 0.25);
                c.copy(bandPalette.upper).lerp(rimTint, blend);
            } else {
                c.copy(bandPalette.rim).lerp(rimGrey, 0.55);
            }

            // Noise variation for natural look
            const noise1 = Math.sin(zLocal * 0.5 + xLocal * 0.3) * 0.5 + 0.5;
            const noise2 = Math.sin(zLocal * 1.2 + xLocal * 0.8) * 0.5 + 0.5;
            const seedNoise = Math.sin(zLocal * 0.77 + segmentId * 0.31) * 0.5 + 0.5;
            const detailNoise = noise1 * 0.08 + noise2 * 0.04 + seedNoise * 0.05;
            const verticalFade = THREE.MathUtils.clamp((warpedRelY + 2.0) / 24.0, 0, 1);
            c.multiplyScalar(0.78 + detailNoise + verticalFade * 0.18);

            // Organic band masks for shader-driven moss/lichen
            const bandNoise = Math.sin(zLocal * 0.3 + xLocal * 0.5) * 0.5 + 0.5;
            const bandNoise2 = Math.cos(zLocal * 0.7 - xLocal * 0.4) * 0.5 + 0.5;
            const normalizedWallHeight = isSlotCanyon ? 22 : 15;
            const heightAboveWater = Math.max(0, Math.min(1, relY / normalizedWallHeight));
            const mossBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.08) / 0.13) * bandNoise;
            const lichenBand = Math.max(0, 1.0 - Math.abs(heightAboveWater - 0.24) / 0.11) * bandNoise2;
            const floodMarkBand = Math.max(
                0,
                1.0 - Math.abs(heightAboveWater - 0.38) / 0.06
            ) * (0.7 + bandNoise * 0.3);

            // Store moss mask for shader use (0-1 range)
            mossMask[i] = Math.max(mossBand, lichenBand * 0.7);
            highWaterMask[i] = floodMarkBand;

            colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;

            const t = (zLocal + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));

            // GUARD: Check if getPoint returns valid result
            let point;
            try {
                point = segmentPath.getPoint(safeT);
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    point = new THREE.Vector3(0, 0, 0);
                }
            } catch (e) {
                point = new THREE.Vector3(0, 0, 0);
            }

            // GUARD: Check values before setting
            const finalX = point.x + xLocal;
            const finalY = point.y + yHeight - 2;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, 10, 0); // high fallback
            }
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('mossMask', new THREE.BufferAttribute(mossMask, 1));
        geo.setAttribute('highWaterMask', new THREE.BufferAttribute(highWaterMask, 1));

        // Compute triplanar UVs (secondary UV channel) to break up texture tiling
        const uv2 = new Float32Array(positions.count * 2);
        const worldPos = new THREE.Vector3();

        for (let i = 0; i < positions.count; i++) {
            worldPos.fromBufferAttribute(positions, i);

            // Triplanar UV projection using world-space XZ and XY
            // Scale factor to control texture density
            const scale = 0.07;
            const triplanarBlend = Math.abs(worldPos.y - WALL_WATERLINE_Y) / 12;

            // Primary triplanar: side projection (XZ plane with Y variation)
            const u1 = worldPos.x * scale;
            const v1 = worldPos.z * scale * 0.42;

            // Secondary: top-down variation for rim areas
            const u2 = (worldPos.x + worldPos.z) * scale * 0.65 + Math.sin(worldPos.y * 0.06) * 0.12;
            const v2 = worldPos.y * scale * 0.28 + Math.cos((worldPos.x - worldPos.z) * 0.04) * 0.08;

            // Blend based on height above water
            const blend = Math.min(1, Math.max(0, triplanarBlend));
            uv2[i * 2] = u1 * (1 - blend) + u2 * blend;
            uv2[i * 2 + 1] = v1 * (1 - blend) + v2 * blend;
        }
        geo.setAttribute('uv2', new THREE.BufferAttribute(uv2, 2));

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, canyonWidth, active, segmentId, biome, biomeProfile.wallHeight, isSlotCanyon, isGlacier]);

    // Water Geometry
    const waterGeometry = useMemo(() => {
        if (!active || !segmentPath) return null;

        // DEFENSIVE CHECK: Ensure valid path length
        const len = segmentPath.getLength();
        if (!len || len <= 0 || !isFinite(len)) {
            console.warn(`[TrackSegment ${segmentId}] Invalid pathLength for water: ${len}`);
            return null;
        }

        const segmentsZ = Math.max(2, Math.floor(len / 2));
        const basePlaneWidth = waterWidth * 1.45;
        const geo = new THREE.PlaneGeometry(basePlaneWidth, len, 8, segmentsZ);
        geo.rotateX(-Math.PI / 2);

        const positions = geo.attributes.position;
        const getChannelShape = (t) => {
            if (!channelProfile.length) {
                return {
                    leftHalfWidth: waterWidth * 0.5,
                    rightHalfWidth: waterWidth * 0.5,
                    corridorHalfWidth: Math.max(3.2, waterWidth * 0.5 - 1.2),
                };
            }
            const scaled = THREE.MathUtils.clamp(t, 0, 1) * (channelProfile.length - 1);
            const lower = Math.floor(scaled);
            const upper = Math.min(channelProfile.length - 1, lower + 1);
            const alpha = scaled - lower;
            const from = channelProfile[lower];
            const to = channelProfile[upper];
            return {
                leftHalfWidth: lerpValue(from.leftHalfWidth, to.leftHalfWidth, alpha),
                rightHalfWidth: lerpValue(from.rightHalfWidth, to.rightHalfWidth, alpha),
                corridorHalfWidth: lerpValue(from.corridorHalfWidth, to.corridorHalfWidth, alpha),
            };
        };

        for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i);
            const z = positions.getZ(i);
            const t = (z + len / 2) / len;
            const safeT = Math.max(0, Math.min(1, t));
            const channelShape = getChannelShape(safeT);
            const halfWidth = x < 0 ? channelShape.leftHalfWidth : channelShape.rightHalfWidth;
            const xNormalized = THREE.MathUtils.clamp(x / (basePlaneWidth * 0.5), -1, 1);
            const shapedX = xNormalized < 0
                ? xNormalized * channelShape.leftHalfWidth
                : xNormalized * channelShape.rightHalfWidth;

            let point;
            try {
                point = segmentPath.getPoint(safeT);
                if (!point || !isFinite(point.x) || !isFinite(point.y) || !isFinite(point.z)) {
                    point = new THREE.Vector3(0, 0, 0);
                }
            } catch (e) {
                point = new THREE.Vector3(0, 0, 0);
            }

            const finalX = point.x + shapedX;
            const finalY = point.y + waterLevel;
            const finalZ = point.z;

            if (isFinite(finalX) && isFinite(finalY) && isFinite(finalZ)) {
                positions.setXYZ(i, finalX, finalY, finalZ);
            } else {
                positions.setXYZ(i, 0, waterLevel, 0);
            }
        }

        // GUARD: Don't compute normals if positions have NaN
        const posArray = positions.array;
        let hasNaN = false;
        for (let i = 0; i < posArray.length; i++) {
            if (!isFinite(posArray[i])) {
                hasNaN = true;
                posArray[i] = 0;
            }
        }
        if (!hasNaN) {
            geo.computeVertexNormals();
        }
        return geo;
    }, [segmentPath, pathLength, waterWidth, active, segmentId, channelProfile]);

    // Waterfall position
    const waterfallPos = useMemo(() => {
        if (!active || type !== 'waterfall' || !segmentPath) return null;
        try {
            const point = segmentPath.getPoint(0.5);
            return hasFiniteCoordinates(point) ? point : null;
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to compute waterfall position`, error);
            return null;
        }
    }, [type, segmentPath, active, segmentId]);

    const plungeImpactPlacement = useMemo(() => {
        if (!active || !segmentPath) return null;

        try {
            if (type === 'waterfall' && waterfallPos) {
                return {
                    position: waterfallPos.clone().add(new THREE.Vector3(0, -10.0, 0)),
                    intensity: 1.0,
                    width: Math.max(6, waterWidth * 0.95),
                };
            }

            if (type === 'splash') {
                const point = segmentPath.getPoint(0.16);
                if (!hasFiniteCoordinates(point)) return null;
                point.y = waterLevel + 0.05;
                return {
                    position: point,
                    intensity: 0.72,
                    width: Math.max(7, waterWidth * 1.1),
                };
            }
        } catch (error) {
            console.warn(`[TrackSegment ${segmentId}] Failed to compute plunge impact placement`, error);
        }

        return null;
    }, [active, segmentId, segmentPath, type, waterfallPos, waterLevel, waterWidth]);

    return { canyonGeometry, wallShellGeometry, waterGeometry, waterfallPos, plungeImpactPlacement };
}