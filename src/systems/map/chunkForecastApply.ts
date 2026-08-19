/**
 * Pure forecast → SegmentData helpers for ChunkManager.
 * Extracted for #371 host size / testability; behavior unchanged.
 */
import * as THREE from 'three';
import { getTrackBiomeProfile, TrackBiomeProfile } from '../../configs/TrackBiomes';
import type { BiomeId } from '../../configs/biomes';
import {
  MapManager,
  buildProceduralSegment,
  INITIAL_TREADMILL_POINTS,
  type BaseMapChunk,
  type DecorationPlacement,
  type SpawnData,
  type SegmentProgressionConfig,
  type VortexConfig,
} from './MapSystem';
import {
  applyForecastToSegmentParams,
  resolveForecastState,
  type ForecastSegmentParams,
} from './flowForecast';

export interface SegmentData {
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
  rockDensity: string;
  segmentState: string;
  wallProfile: TrackBiomeProfile;
  forwardMomentum?: number;
  meanderStrength?: number;
  verticalBias?: number;
  /** Per-segment gravity scale from level data (undefined = use world default). */
  gravityMultiplier?: number;
  /** Pre-calculated spawn data for objects. */
  spawns?: SpawnData[];
  /** Forecast-driven washed-out bridge/gap flag. */
  washedOutGap?: boolean;
  /** Extra slipperiness layered on authored ice/biome slip (0–1). */
  slipperinessAdd?: number;
  /** Survive-this-state score bonus (awarded on clean exit). */
  surviveBonus?: number;
  /** Pre-forecast params so live forecast updates never double-multiply. */
  _forecastBase?: ForecastSegmentParams;
  /** Authored decoration / launch-shelf overrides passed through to TrackSegment. */
  config?: {
    decorations?: Record<string, number | DecorationPlacement[]>;
    launchShelf?: { rockRef: { localX: number; localZ: number; scale: number } };
    hasBridge?: boolean;
    washedOutGap?: boolean;
    openFloor?: boolean;
    vortex?: VortexConfig;
  };
  /** Backing MapSystem chunk for pool recycling. */
  _baseChunk?: BaseMapChunk;
}

export function baseChunkToSegmentData(
  chunk: BaseMapChunk,
  progression: SegmentProgressionConfig,
  forecastState: string,
): SegmentData {
  const biomeProfile = getTrackBiomeProfile(progression.biome);
  const hasBridge = Boolean((chunk.config as { hasBridge?: boolean } | undefined)?.hasBridge);
  const forecastBase: ForecastSegmentParams = {
    type: progression.type,
    width: progression.width,
    waterWidth: progression.waterWidth,
    flowSpeed: progression.flowSpeed,
    particleCount: progression.particleCount || 0,
    rockDensity: progression.rockDensity,
    cameraShake: progression.cameraShake || 0,
    hasBridge,
    washedOutGap: Boolean((chunk.config as { washedOutGap?: boolean } | undefined)?.washedOutGap),
  };
  const applied = applyForecastToSegmentParams(forecastBase, forecastState);
  const authoredOpenFloor = Boolean(
    (chunk.config as { openFloor?: boolean } | undefined)?.openFloor,
  );
  const vortex = (chunk.config as { vortex?: VortexConfig } | undefined)?.vortex;

  return {
    id: chunk.index,
    type: applied.type,
    biome: biomeProfile.id,
    points: chunk.pathPoints,
    segmentPath: chunk.curve!,
    width: applied.width,
    waterWidth: applied.waterWidth,
    flowSpeed: applied.flowSpeed,
    particleCount: applied.particleCount,
    cameraShake: applied.cameraShake ?? 0,
    treeDensity: progression.treeDensity,
    rockDensity: applied.rockDensity,
    segmentState: applied.segmentState,
    wallProfile: biomeProfile,
    forwardMomentum: progression.forwardMomentum,
    meanderStrength: progression.meanderStrength,
    verticalBias: progression.verticalBias,
    gravityMultiplier: progression.gravityMultiplier,
    spawns: chunk.spawns,
    washedOutGap: applied.washedOutGap,
    slipperinessAdd: applied.slipperinessAdd,
    surviveBonus: applied.surviveBonus,
    _forecastBase: forecastBase,
    config: {
      ...chunk.config,
      washedOutGap: applied.washedOutGap,
      hasBridge,
      // Washed-out bridges / catwalks become air corridors.
      openFloor: authoredOpenFloor || applied.washedOutGap,
      vortex,
    },
    _baseChunk: chunk,
  };
}

export function applyLiveForecast(
  segment: SegmentData,
  forecastState: string,
): SegmentData {
  const base = segment._forecastBase;
  if (!base) {
    return {
      ...segment,
      segmentState: resolveForecastState(undefined, 0, forecastState),
    };
  }
  const applied = applyForecastToSegmentParams(base, forecastState);
  // Prefer chunk-authored openFloor; always OR with live washedOutGap.
  const baseOpenFloor = Boolean(
    (segment._baseChunk?.config as { openFloor?: boolean } | undefined)?.openFloor,
  );
  return {
    ...segment,
    type: applied.type,
    width: applied.width,
    waterWidth: applied.waterWidth,
    flowSpeed: applied.flowSpeed,
    particleCount: applied.particleCount,
    rockDensity: applied.rockDensity,
    cameraShake: applied.cameraShake ?? 0,
    segmentState: applied.segmentState,
    washedOutGap: applied.washedOutGap,
    slipperinessAdd: applied.slipperinessAdd,
    surviveBonus: applied.surviveBonus,
    config: {
      ...segment.config,
      washedOutGap: applied.washedOutGap,
      openFloor: baseOpenFloor || applied.washedOutGap,
    },
  };
}

export function createSegmentData(
  index: number,
  previousSegment: SegmentData | null,
  forecastState: string,
  mapManager: MapManager,
  ensureContinuity = false,
  proceduralBaseSeed?: number,
): SegmentData {
  const previousPoints = previousSegment?.points ?? null;
  const { chunk, progression } = buildProceduralSegment(index, previousPoints, mapManager, {
    ensureContinuity: ensureContinuity && !!previousSegment?.points,
    initialPoints: INITIAL_TREADMILL_POINTS,
    baseSeed: proceduralBaseSeed,
  });
  return baseChunkToSegmentData(chunk, progression, forecastState);
}
