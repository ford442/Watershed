/**
 * ReachNormalizer.ts
 *
 * Converts a validated Reach manifest into TrackManager-ready segment data.
 * Forecast multipliers use the same pure `applyForecastToSegmentParams` as
 * ChunkManager so Reach and map-driven paths never desync.
 */

import * as THREE from 'three';
import { ReachManifest } from './ReachStreamer';
import { getTrackBiomeProfile, TrackBiomeProfile } from '../configs/TrackBiomes';
import { type BiomeId, normalizeBiomeId } from '../configs/biomes';
import { FLOW_FORECAST_STATES } from '../constants/game';
import {
  applyForecastToSegmentParams,
  resolveForecastState,
  type ForecastSegmentParams,
} from './flowForecast';

export interface NormalizedSegment {
  id: number;
  type: string;
  biome: BiomeId;
  points: THREE.Vector3[];
  segmentPath: THREE.CatmullRomCurve3;
  width: number;
  waterWidth: number;
  flowSpeed: number;
  particleCount: number;
  cameraShake: number;
  treeDensity: number;
  rockDensity: 'low' | 'medium' | 'high';
  segmentState: string;
  wallProfile: TrackBiomeProfile;
  forwardMomentum: number;
  meanderStrength: number;
  verticalBias: number;
  washedOutGap?: boolean;
  slipperinessAdd?: number;
  surviveBonus?: number;
  /** Pre-forecast params for live re-application in ChunkManager. */
  _forecastBase?: ForecastSegmentParams;
  // Passthrough of original config for TrackSegment extras
  config: any;
}

/**
 * ensureTangentContinuity — forces the new segment's start tangent to match
 * the previous segment's end tangent. This eliminates NaNs in Catmull-Rom
 * derivative math at segment joints.
 */
function ensureTangentContinuity(
  prevPoints: THREE.Vector3[],
  newPoints: THREE.Vector3[]
): THREE.Vector3[] {
  if (!prevPoints || prevPoints.length < 2 || newPoints.length < 2) {
    return newPoints;
  }

  const lastTwo = prevPoints.slice(-2);
  const prevTangent = new THREE.Vector3()
    .subVectors(lastTwo[1], lastTwo[0])
    .normalize();

  if (!prevTangent.lengthSq() || !isFinite(prevTangent.x)) {
    console.warn('[ensureTangentContinuity] Invalid previous tangent, skipping');
    return newPoints;
  }

  const desiredStart = newPoints[0].clone().add(prevTangent.multiplyScalar(0.01));
  newPoints[0] = desiredStart;

  return newPoints;
}

function createSpline(points: THREE.Vector3[], type: string): THREE.CatmullRomCurve3 {
  const tension = type === 'pond' ? 0.1 : 0.5;
  return new THREE.CatmullRomCurve3(points, false, 'catmullrom', tension);
}

export type NormalizeReachOptions = {
  /** Single state applied to every segment (legacy). */
  forecastState?: string;
  /** Per-index states — preferred; mirrors TrackManager forecastByIndex. */
  forecastByIndex?: Map<number, string>;
};

/**
 * Normalize a Reach manifest into an array of TrackManager-compatible segments.
 */
export function normalizeReachManifest(
  manifest: ReachManifest,
  previousSegment?: NormalizedSegment,
  forecastStateOrOptions: string | NormalizeReachOptions = FLOW_FORECAST_STATES.NORMAL,
): NormalizedSegment[] {
  const options: NormalizeReachOptions =
    typeof forecastStateOrOptions === 'string'
      ? { forecastState: forecastStateOrOptions }
      : forecastStateOrOptions;

  const baseBiome = normalizeBiomeId(manifest.world?.biome?.baseType || 'creek-summer');
  const baseBiomeProfile = getTrackBiomeProfile(baseBiome);

  const waypoints = manifest.world.track.waypoints.map(
    (p: number[]) => new THREE.Vector3(p[0], p[1], p[2])
  );

  const curve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);
  const totalSegments = manifest.world.track.totalSegments;

  const normalized: NormalizedSegment[] = [];

  for (let i = 0; i < totalSegments; i++) {
    const segConfig = manifest.segments[i];
    if (!segConfig) {
      console.warn(`[ReachNormalizer] Missing segment config for index ${i}, skipping`);
      continue;
    }

    const biomeOverride = segConfig.biomeOverride
      ? normalizeBiomeId(segConfig.biomeOverride)
      : undefined;
    const biome = biomeOverride || baseBiome;
    const wallProfile = getTrackBiomeProfile(biome);

    // Calculate 4 points along the curve for this segment
    const tStart = i / totalSegments;
    const tEnd = (i + 1) / totalSegments;
    const numPoints = 4;
    const points: THREE.Vector3[] = [];

    for (let p = 0; p < numPoints; p++) {
      const t = tStart + (tEnd - tStart) * (p / (numPoints - 1));
      points.push(curve.getPoint(Math.min(1, t)));
    }

    // Apply tangent continuity to first segment if previousSegment is provided
    const continuousPoints =
      i === 0 && previousSegment?.points
        ? ensureTangentContinuity(previousSegment.points, points)
        : points;

    // Resolve runtime base fields (pre-forecast)
    const width =
      segConfig.width !== undefined ? segConfig.width : wallProfile.canyonWidth;
    const waterWidth =
      segConfig.waterWidth !== undefined
        ? segConfig.waterWidth
        : wallProfile.waterWidth;
    const flowSpeed =
      (manifest.world?.biome?.water?.flowSpeed || 1) *
      (segConfig.forwardMomentum !== undefined ? segConfig.forwardMomentum : 1);
    const particleCount = segConfig.effects?.particleCount || 0;
    const cameraShake = segConfig.effects?.cameraShake || 0;
    const treeDensity =
      segConfig.decorations?.trees !== undefined
        ? segConfig.decorations.trees / 50 // normalize to 0-1 range
        : wallProfile.vegetationDensity;
    const rockDensity = segConfig.rockDensity || wallProfile.rockDensity;
    const baseType = segConfig.type || 'normal';

    const forecastBase: ForecastSegmentParams = {
      type: baseType,
      width,
      waterWidth,
      flowSpeed,
      particleCount,
      rockDensity,
      cameraShake,
      hasBridge: Boolean(segConfig.hasBridge),
      washedOutGap: Boolean(segConfig.washedOutGap),
    };

    const forecastState = resolveForecastState(
      options.forecastByIndex,
      i,
      options.forecastState ?? FLOW_FORECAST_STATES.NORMAL,
    );
    const applied = applyForecastToSegmentParams(forecastBase, forecastState);
    const segmentPath = createSpline(continuousPoints, applied.type);

    normalized.push({
      id: i,
      type: applied.type,
      biome,
      points: continuousPoints,
      segmentPath,
      width: applied.width,
      waterWidth: applied.waterWidth,
      flowSpeed: applied.flowSpeed,
      particleCount: applied.particleCount,
      cameraShake: applied.cameraShake ?? 0,
      treeDensity,
      rockDensity: applied.rockDensity as 'low' | 'medium' | 'high',
      segmentState: applied.segmentState,
      wallProfile,
      forwardMomentum: segConfig.forwardMomentum !== undefined ? segConfig.forwardMomentum : 1,
      meanderStrength: segConfig.meanderStrength !== undefined ? segConfig.meanderStrength : 1.2,
      verticalBias: segConfig.verticalBias !== undefined ? segConfig.verticalBias : -0.5,
      washedOutGap: applied.washedOutGap,
      slipperinessAdd: applied.slipperinessAdd,
      surviveBonus: applied.surviveBonus,
      _forecastBase: forecastBase,
      config: segConfig,
    });
  }

  return normalized;
}

export default normalizeReachManifest;
