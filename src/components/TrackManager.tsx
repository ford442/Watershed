import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import TrackSegment from './TrackSegment';
import WaterFlowForces from './WaterFlowForces';
import VehicleTuner from './VehicleTuner';
import PooledObstacles from './PooledObstacles';
import { extendRiverMaterial } from '../utils/RiverShader';
import { WATER_LEVEL, REACH_API_BASE } from '../constants/game';
import { AssetCache } from '../systems/ReachStreamer';
import { useNightMode } from '../hooks/useNightMode';
import {
  ProceduralMapManager,
  type MapManager,
  type SegmentRange,
  type LevelData,
} from '../systems/MapSystem';
import { getActiveMap, getMapDefinition, type MapDefinition, type MapRegistryId } from '../maps/registry';
import { getProceduralBaseSeed } from '../utils/runContext';
import { ChunkManager } from '../systems/ChunkManager';
import { createObstaclePool } from '../systems/ObstaclePool';
import { useGameStore } from '../systems/GameState';
import type { NormalizedSegment } from '../systems/ReachNormalizer';
import type { BiomeId } from '../configs/biomes';

export interface TrackManagerRef {
  synthesizeSegmentEnter: (index: number) => void;
  isInitialized: () => boolean;
  getLastEnteredSegment: () => number;
}

export interface TrackManagerProps {
  onBiomeChange?: (biome: BiomeId, segmentIndex?: number) => void;
  raftRef?: React.RefObject<any>;
  forecastSamples?: Array<{ state: string; [key: string]: unknown }>;
  reachSegments?: NormalizedSegment[] | null;
  reachId?: string | null;
  mapData?: LevelData | null;
  mapId?: MapRegistryId;
  mapDefinition?: MapDefinition;
  startIndex?: number;
  /** @deprecated Use mapId / mapDefinition instead */
  mapProgression?: SegmentRange[];
}

interface RenderSlot {
  slotIndex: number;
  active: boolean;
  segment: any;
}

function cloneForRender(segment: any, slotIndex: number, active: boolean): RenderSlot {
  if (!segment) {
    return {
      slotIndex,
      active: false,
      segment: null,
    };
  }

  return {
    slotIndex,
    active,
    segment,
  };
}

const TrackManager = forwardRef<TrackManagerRef, TrackManagerProps>(function TrackManager(
  {
    onBiomeChange,
    raftRef,
    forecastSamples = [],
    reachSegments = null,
    reachId = null,
    mapData = null,
    mapId,
    mapDefinition,
    startIndex,
    mapProgression,
  },
  ref
) {
  const resolvedMap = mapDefinition ?? (mapId ? getMapDefinition(mapId) : getActiveMap());
  const effectiveStartIndex = startIndex ?? resolvedMap.startIndex;
  const effectiveLevelData = mapData ?? resolvedMap.levelData;
  const effectiveFallback =
    mapProgression ?? resolvedMap.fallbackProgression;

  const { camera, scene } = useThree();
  const [poolVersion, setPoolVersion] = useState(0);
  const [obstaclePoolVersion, setObstaclePoolVersion] = useState(0);
  const { isNight } = useNightMode();

  const chunkManagerRef = useRef<ChunkManager | null>(null);
  const pendingSynthesizesRef = useRef<number[]>([]);

  useImperativeHandle(ref, () => ({
    synthesizeSegmentEnter: (index: number) => {
      if (chunkManagerRef.current?.isInitialized()) {
        chunkManagerRef.current.synthesizeSegmentEnter(index);
      } else {
        pendingSynthesizesRef.current.push(index);
      }
    },
    isInitialized: () => chunkManagerRef.current?.isInitialized() ?? false,
    getLastEnteredSegment: () => chunkManagerRef.current?.getLastEnteredSegment?.() ?? -1,
  }));

  const forecastByIndexRef = useRef<Map<number, string>>(new Map());
  const weatherWetnessRef = useRef(0);
  const mapManagerRef = useRef<MapManager>(
    new ProceduralMapManager(
      effectiveLevelData,
      effectiveFallback,
      {},
      resolvedMap.continuation ?? null,
    ),
  );
  const reachSegmentsRef = useRef(reachSegments);
  const obstaclePoolRef = useRef(createObstaclePool(16));

  // Keep reachSegments ref in sync
  useEffect(() => {
    reachSegmentsRef.current = reachSegments;
    if (chunkManagerRef.current && chunkManagerRef.current.isInitialized()) {
      chunkManagerRef.current.reset(reachSegments);
      chunkManagerRef.current.initializePool();
      setPoolVersion((v) => v + 1);
    }
  }, [reachSegments]);

  // Weather listener
  useEffect(() => {
    const onWeatherUpdate = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      weatherWetnessRef.current = detail?.rippleStrength || 0;
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

  // PBR texture loading
  const [colorMap, normalMap, roughnessMap, aoMap, displacementMap] = useTexture([
    './Rock031_1K-JPG_Color.jpg',
    './Rock031_1K-JPG_NormalGL.jpg',
    './Rock031_1K-JPG_Roughness.jpg',
    './Rock031_1K-JPG_AmbientOcclusion.jpg',
    './Rock031_1K-JPG_Displacement.jpg',
  ]);

  // Fallback texture generator
  const fallbackTextures = useMemo(() => {
    const createFallbackTexture = (colorHex: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const ctx = canvas.getContext('2d');
      if (!ctx) return new THREE.CanvasTexture(canvas);
      ctx.fillStyle = colorHex;
      ctx.fillRect(0, 0, 2, 2);
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      return texture;
    };

    return {
      colorMap: createFallbackTexture('#8B7355'),
      normalMap: createFallbackTexture('#8080FF'),
      roughnessMap: createFallbackTexture('#D9D9D9'),
      aoMap: createFallbackTexture('#FFFFFF'),
      displacementMap: createFallbackTexture('#FFFFFF'),
    };
  }, []);

  useEffect(() => {
    const textures = [colorMap, normalMap, roughnessMap, aoMap, displacementMap];
    textures.forEach((texture) => {
      if (!texture) return;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 8);
    });
  }, [colorMap, normalMap, roughnessMap, aoMap, displacementMap]);

  // Rock material
  const rockMaterial = useMemo(() => {
    let effectiveColorMap = colorMap || fallbackTextures.colorMap;
    let effectiveNormalMap = normalMap || fallbackTextures.normalMap;
    let effectiveRoughnessMap = roughnessMap || fallbackTextures.roughnessMap;
    let effectiveAoMap = aoMap || fallbackTextures.aoMap;
    let effectiveDisplacementMap = displacementMap || fallbackTextures.displacementMap;

    if (reachId) {
      const manifest = AssetCache.reaches.get(reachId);
      const reachTextures = manifest?.requiredAssets?.textures ?? [];
      const textureById = new Map(reachTextures.map((asset) => [asset.id, asset.url]));
      const resolveTexture = (role: string) => {
        const filename = textureById.get(role);
        if (!filename) return null;
        const url =
          filename.startsWith('http://') ||
          filename.startsWith('https://') ||
          filename.startsWith('/')
            ? filename
            : `${REACH_API_BASE}/${reachId}/assets/${filename}`;
        return AssetCache.textures.get(url) || null;
      };
      effectiveColorMap = resolveTexture('color') || effectiveColorMap;
      effectiveNormalMap = resolveTexture('normal') || effectiveNormalMap;
      effectiveRoughnessMap = resolveTexture('roughness') || effectiveRoughnessMap;
      effectiveAoMap = resolveTexture('ao') || effectiveAoMap;
      effectiveDisplacementMap = resolveTexture('displacement') || effectiveDisplacementMap;
    }

    const hasRealTextures = !!(effectiveColorMap && effectiveNormalMap);

    if (!hasRealTextures) {
      console.log('[TrackManager] Using fallback textures for rock material');
    }

    const material = new THREE.MeshStandardMaterial({
      map: effectiveColorMap as THREE.Texture,
      normalMap: effectiveNormalMap as THREE.Texture,
      roughnessMap: effectiveRoughnessMap as THREE.Texture,
      aoMap: effectiveAoMap as THREE.Texture,
      roughness: 0.85,
      metalness: 0.05,
      vertexColors: true,
      side: THREE.DoubleSide,
      color: hasRealTextures ? new THREE.Color('#ffffff') : new THREE.Color('#8B7355'),
    });
    material.displacementMap = effectiveDisplacementMap as THREE.Texture;

    try {
      return extendRiverMaterial(material, {
        waterLevel: WATER_LEVEL,
        enableMoss: false,
        enableTriplanar: false,
      });
    } catch (err) {
      console.warn('[TrackManager] Failed to extend river material:', err);
      return material;
    }
  }, [aoMap, colorMap, displacementMap, fallbackTextures, normalMap, reachId, roughnessMap]);

  // Forecast updates
  useEffect(() => {
    const nextForecastMap = new Map<number, string>();
    forecastSamples.forEach((sample, index) => {
      nextForecastMap.set(index, sample.state);
    });
    forecastByIndexRef.current = nextForecastMap;

    if (chunkManagerRef.current && chunkManagerRef.current.isInitialized()) {
      chunkManagerRef.current.setForecastByIndex(nextForecastMap);
      setPoolVersion((v) => v + 1);
    }
  }, [forecastSamples]);

  useEffect(() => {
    mapManagerRef.current = new ProceduralMapManager(
      effectiveLevelData,
      effectiveFallback,
      {},
      resolvedMap.continuation ?? null,
    );
    if (chunkManagerRef.current?.isInitialized()) {
      chunkManagerRef.current.reset(reachSegmentsRef.current);
      chunkManagerRef.current.initializePool();
      setPoolVersion((v) => v + 1);
    }
  }, [effectiveLevelData, effectiveFallback, resolvedMap.id, resolvedMap.continuation]);

  // Initialize ChunkManager when material is ready
  useEffect(() => {
    if (!rockMaterial || chunkManagerRef.current?.isInitialized()) return;

    const callbacks = {
      onPoolChange: () => setPoolVersion((v) => v + 1),
      onBiomeChange: (biome: BiomeId, segmentIndex: number) => {
        onBiomeChange?.(biome, segmentIndex);
      },
      onSegmentEnter: (index: number) => {
        const activeSegments = chunkManagerRef.current?.getActiveSegments?.() ?? [];
        const entered = activeSegments.find((s: any) => s?.id === index);
        const flowSpeed = entered?.flowSpeed ?? 1.0;
        const gravityMultiplier = entered?.gravityMultiplier;
        // slipperiness is stored on the config, not the live SegmentData — read from map manager
        const segCfg = mapManagerRef.current?.getChunkConfig?.(index);
        const slipperiness = segCfg?.slipperiness ?? 0;
        (window as any).__watershedFlowSpeed = flowSpeed;
        (window as any).__watershedSlipperiness = slipperiness;
        window.dispatchEvent(
          new CustomEvent('segment-enter', {
            detail: { segmentIndex: index, flowSpeed, gravityMultiplier, slipperiness },
          })
        );

        const segmentConfig = mapManagerRef.current?.getChunkConfig?.(index);
        if (segmentConfig?.journeyComplete && !useGameStore.getState().isJourneyComplete) {
          useGameStore.getState().setJourneyComplete();
        }
      },
    };

    chunkManagerRef.current = new ChunkManager({
      mapManager: mapManagerRef.current,
      reachSegments: reachSegmentsRef.current,
      forecastByIndex: forecastByIndexRef.current,
      callbacks,
      startIndex: effectiveStartIndex,
      proceduralBaseSeed: getProceduralBaseSeed(),
    });

    chunkManagerRef.current.initializePool();
    setPoolVersion((v) => v + 1);

    // Flush any synthesizeSegmentEnter calls that arrived before the
    // rockMaterial-gated initialization completed (e.g. screenshot teleport).
    const pending = pendingSynthesizesRef.current;
    if (pending.length > 0) {
      pendingSynthesizesRef.current = [];
      pending.sort((a, b) => a - b);
      pending.forEach((index) => {
        chunkManagerRef.current?.synthesizeSegmentEnter?.(index);
      });
    }

    return () => {
      chunkManagerRef.current?.dispose?.();
      chunkManagerRef.current = null;
      pendingSynthesizesRef.current = [];
    };
  }, [rockMaterial, onBiomeChange, reachSegments, effectiveStartIndex]);

  // Night mode: update scene fog and background
  useEffect(() => {
    if (!scene) return;

    const skyColor = isNight ? '#0a1428' : '#87ceeb';
    const fogColor = isNight ? '#1a2a4a' : '#a5d6ff';
    const fogNear = isNight ? 10 : 20;
    const fogFar = isNight ? 100 : 150;

    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    console.log(`[TrackManager] ${isNight ? '🌙 Night' : '☀️ Day'} mode activated`);
  }, [isNight, scene]);

  // Per-frame update: delegate generation and recycling to ChunkManager
  useFrame(() => {
    if (!chunkManagerRef.current?.isInitialized()) return;

    const { x, y, z } = camera.position;
    const cameraSane =
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(z) &&
      y >= -80 &&
      y <= 250 &&
      Math.abs(x) <= 6000 &&
      Math.abs(z) <= 6000;
    if (!cameraSane) return;

    const result = chunkManagerRef.current.update(camera.position.z);

    if (result.poolChanged) {
      setPoolVersion((v) => v + 1);
    }
  });

  const renderedSlots = useMemo(() => {
    if (!chunkManagerRef.current?.isInitialized()) {
      return [];
    }
    return chunkManagerRef.current.getRenderedSlots().map((slot) =>
      cloneForRender(slot.segment, slot.slotIndex, slot.active)
    );
  }, [poolVersion]);

  const activeSegments = useMemo(() => {
    if (!chunkManagerRef.current?.isInitialized()) {
      return [];
    }
    return chunkManagerRef.current.getActiveSegments();
  }, [poolVersion]);

  useEffect(() => {
    obstaclePoolRef.current.syncSegments(activeSegments);
    setObstaclePoolVersion((v) => v + 1);
  }, [activeSegments]);

  const pooledObstacleSlots = useMemo(
    () => obstaclePoolRef.current.getSnapshot(),
    [obstaclePoolVersion]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    (window as any).__watershedObstaclePool = {
      size: pooledObstacleSlots.length,
      active: pooledObstacleSlots.filter((slot: any) => slot.active).length,
      types: pooledObstacleSlots.reduce((acc: Record<string, number>, slot: any) => {
        if (slot.active) acc[slot.type] = (acc[slot.type] || 0) + 1;
        return acc;
      }, {}),
    };
  }, [pooledObstacleSlots]);

  return (
    <group name="track-manager">
      {renderedSlots.map(({ slotIndex, active, segment }) => (
        <TrackSegment
          key={slotIndex}
          active={active}
          segmentId={segment?.id}
          rockMaterial={rockMaterial}
          rockNormalMap={normalMap}
          raftRef={raftRef}
          segmentPath={segment?.segmentPath}
          segmentState={segment?.segmentState || 'Normal'}
          waterWidth={segment?.waterWidth}
          biome={segment?.biome || 'canyonSummer'}
          isNight={isNight}
          weatherWetnessRef={weatherWetnessRef}
          usePooledStaticObstacles
          {...(segment || {})}
        />
      ))}

      <PooledObstacles slots={pooledObstacleSlots} rockMaterial={rockMaterial} />
      {raftRef && (
        <>
          <WaterFlowForces targetRef={raftRef} segments={activeSegments} reachId={reachId ?? undefined} />
          <VehicleTuner targetRef={raftRef} segments={activeSegments} />
        </>
      )}
    </group>
  );
});

export default TrackManager;
