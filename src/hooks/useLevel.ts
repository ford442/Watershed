/**
 * useLevel Hook
 * 
 * React hook for managing level state, loading, and caching.
 * Provides a clean interface for the LevelLoader and Editor UI.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { validateLevel, ValidationResult, formatValidationErrors } from '../utils/levelValidator';

// Level state types
export type LevelLoadingState = 'idle' | 'loading' | 'loaded' | 'error';

export interface LevelMetadata {
  name: string;
  author: string;
  description?: string;
  difficulty: 'beginner' | 'intermediate' | 'expert' | 'custom';
  estimatedDuration: number;
  version: string;
  tags?: string[];
}

export interface TrackConfig {
  waypoints: [number, number, number][];
  segmentLength: number;
  totalSegments: number;
  width: number;
  wallHeight: number;
}

export interface BiomeConfig {
  baseType: string;
  sky: {
    color: string;
    cloudDensity: number;
    cloudColor?: string;
  };
  fog: {
    color: string;
    near: number;
    far: number;
    density?: number;
  };
  lighting: {
    sunIntensity: number;
    sunAngle: number;
    sunColor?: string;
    ambientIntensity: number;
    hemiSkyColor?: string;
    hemiGroundColor?: string;
  };
  water: {
    tint: string;
    flowSpeed: number;
    opacity: number;
    surfaceRoughness?: number;
  };
}

export interface SegmentConfig {
  index: number;
  name?: string;
  type: 'normal' | 'waterfall' | 'pond' | 'splash' | 'rapids';
  biomeOverride?: string;
  difficulty: number;
  width?: number;
  lengthMultiplier?: number;
  meanderStrength: number;
  verticalBias: number;
  forwardMomentum: number;
  decorations: Record<string, number>;
  physics?: {
    gravityMultiplier?: number;
    waterFlowIntensity?: number;
    friction?: number;
    restitution?: number;
  };
  safeZone?: {
    yMin: number;
    yMax: number;
    respawnAt?: number;
  };
  effects?: {
    particleCount?: number;
    cameraShake?: number;
    fogDensity?: number;
    transitionDuration?: number;
  };
}

export interface SpawnConfig {
  start: {
    position: [number, number, number];
    rotation?: [number, number, number];
    velocity?: [number, number, number];
  };
  checkpoints?: Array<{
    segment: number;
    position: [number, number, number];
    radius?: number;
  }>;
}

export interface NormalizedLevelState {
  metadata: LevelMetadata;
  track: TrackConfig;
  biome: BiomeConfig;
  segments: SegmentConfig[];
  spawns: SpawnConfig;
  // Runtime data
  curve: THREE.CatmullRomCurve3;
  initialSegments: Array<{
    id: number;
    type: string;
    biome: string;
    points: THREE.Vector3[];
    config: SegmentConfig;
  }>;
}

export interface LevelState {
  loadingState: LevelLoadingState;
  levelData: any | null;
  normalizedState: NormalizedLevelState | null;
  validationResult: ValidationResult | null;
  error: string | null;
  currentLevelId: string | null;
}

// Cache for loaded levels
interface LevelCacheEntry {
  data: any;
  normalized: NormalizedLevelState;
  timestamp: number;
}

const levelCache = new Map<string, LevelCacheEntry>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export interface UseLevelReturn {
  // State
  loadingState: LevelLoadingState;
  levelData: any | null;
  normalizedState: NormalizedLevelState | null;
  validationResult: ValidationResult | null;
  error: string | null;
  currentLevelId: string | null;

  // Actions
  loadFromJSON: (json: any, levelId?: string) => Promise<boolean>;
  loadFromURL: (url: string) => Promise<boolean>;
  loadFromFile: (file: File) => Promise<boolean>;
  clearLevel: () => void;
  reloadCurrent: () => Promise<boolean>;

  // Utilities
  isValid: () => boolean;
  getValidationReport: () => string;
  getCachedLevels: () => string[];
  clearCache: () => void;
}

export function useLevel(): UseLevelReturn {
  const [state, setState] = useState<LevelState>({
    loadingState: 'idle',
    levelData: null,
    normalizedState: null,
    validationResult: null,
    error: null,
    currentLevelId: null,
  });

  const currentUrlRef = useRef<string | null>(null);

  // Clean up expired cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const keysToDelete: string[] = [];
      levelCache.forEach((entry, key) => {
        if (now - entry.timestamp > CACHE_DURATION) {
          keysToDelete.push(key);
        }
      });
      keysToDelete.forEach(key => levelCache.delete(key));
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, []);

  /**
   * Normalize level data into runtime state
   */
  const normalizeLevelData = useCallback((data: any): NormalizedLevelState => {
    // Create CatmullRom curve from waypoints
    const waypoints = data.world.track.waypoints.map(
      (p: number[]) => new THREE.Vector3(p[0], p[1], p[2])
    );
    const curve = new THREE.CatmullRomCurve3(
      waypoints,
      false,
      'catmullrom',
      0.5
    );

    // Build initial segments from level data
    const initialSegments = data.segments.map((seg: any) => {
      // Calculate points for this segment along the curve
      const tStart = seg.index / data.world.track.totalSegments;
      const tEnd = (seg.index + 1) / data.world.track.totalSegments;
      
      const points: THREE.Vector3[] = [];
      const numPoints = 4;
      for (let i = 0; i < numPoints; i++) {
        const t = tStart + (tEnd - tStart) * (i / (numPoints - 1));
        points.push(curve.getPoint(Math.min(1, t)));
      }

      return {
        id: seg.index,
        type: seg.type || 'normal',
        biome: seg.biomeOverride || data.world.biome.baseType,
        points,
        config: seg as SegmentConfig,
      };
    });

    // Ensure we have at least 2 initial segments
    while (initialSegments.length < 2 && data.world.track.totalSegments >= 2) {
      const lastSeg = initialSegments[initialSegments.length - 1];
      const nextIdx = initialSegments.length;
      
      const tStart = nextIdx / data.world.track.totalSegments;
      const tEnd = (nextIdx + 1) / data.world.track.totalSegments;
      
      const points: THREE.Vector3[] = [];
      const numPoints = 4;
      for (let i = 0; i < numPoints; i++) {
        const t = tStart + (tEnd - tStart) * (i / (numPoints - 1));
        points.push(curve.getPoint(Math.min(1, t)));
      }

      initialSegments.push({
        id: nextIdx,
        type: 'normal',
        biome: data.world.biome.baseType,
        points,
        config: {
          index: nextIdx,
          difficulty: 0.3,
          meanderStrength: 1.2,
          verticalBias: -0.5,
          forwardMomentum: 1.0,
          decorations: {},
        },
      });
    }

    return {
      metadata: data.metadata,
      track: {
        waypoints: data.world.track.waypoints,
        segmentLength: data.world.track.segmentLength ?? 30,
        totalSegments: data.world.track.totalSegments,
        width: data.world.track.width ?? 35,
        wallHeight: data.world.track.wallHeight ?? 12,
      },
      biome: {
        baseType: data.world.biome.baseType,
        sky: {
          color: data.world.biome.sky.color,
          cloudDensity: data.world.biome.sky.cloudDensity ?? 0.4,
          cloudColor: data.world.biome.sky.cloudColor,
        },
        fog: {
          color: data.world.biome.fog.color,
          near: data.world.biome.fog.near,
          far: data.world.biome.fog.far,
          density: data.world.biome.fog.density,
        },
        lighting: {
          sunIntensity: data.world.biome.lighting.sunIntensity,
          sunAngle: data.world.biome.lighting.sunAngle,
          sunColor: data.world.biome.lighting.sunColor,
          ambientIntensity: data.world.biome.lighting.ambientIntensity ?? 0.4,
          hemiSkyColor: data.world.biome.lighting.hemiSkyColor,
          hemiGroundColor: data.world.biome.lighting.hemiGroundColor,
        },
        water: {
          tint: data.world.biome.water.tint,
          flowSpeed: data.world.biome.water.flowSpeed,
          opacity: data.world.biome.water.opacity ?? 0.6,
          surfaceRoughness: data.world.biome.water.surfaceRoughness,
        },
      },
      segments: data.segments,
      spawns: data.spawns,
      curve,
      initialSegments,
    };
  }, []);

  /**
   * Load level from JSON object
   */
  const loadFromJSON = useCallback(async (json: any, levelId?: string): Promise<boolean> => {
    setState(prev => ({ ...prev, loadingState: 'loading', error: null }));

    try {
      // Check cache
      const cacheKey = levelId || JSON.stringify(json).slice(0, 100);
      const cached = levelCache.get(cacheKey);
      
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setState({
          loadingState: 'loaded',
          levelData: cached.data,
          normalizedState: cached.normalized,
          validationResult: { valid: true, errors: [], warnings: [] },
          error: null,
          currentLevelId: levelId || cacheKey,
        });
        return true;
      }

      // Validate
      const validationResult = validateLevel(json);
      
      if (!validationResult.valid) {
        setState({
          loadingState: 'error',
          levelData: json,
          normalizedState: null,
          validationResult,
          error: formatValidationErrors(validationResult),
          currentLevelId: null,
        });
        return false;
      }

      // Normalize
      const normalizedState = normalizeLevelData(json);

      // Cache
      levelCache.set(cacheKey, {
        data: json,
        normalized: normalizedState,
        timestamp: Date.now(),
      });

      setState({
        loadingState: 'loaded',
        levelData: json,
        normalizedState,
        validationResult,
        error: null,
        currentLevelId: levelId || cacheKey,
      });

      return true;
    } catch (err) {
      setState({
        loadingState: 'error',
        levelData: json,
        normalizedState: null,
        validationResult: null,
        error: err instanceof Error ? err.message : 'Unknown error loading level',
        currentLevelId: null,
      });
      return false;
    }
  }, [normalizeLevelData]);

  /**
   * Load level from URL
   */
  const loadFromURL = useCallback(async (url: string): Promise<boolean> => {
    setState(prev => ({ ...prev, loadingState: 'loading', error: null }));
    currentUrlRef.current = url;

    try {
      // Check cache
      const cached = levelCache.get(url);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        setState({
          loadingState: 'loaded',
          levelData: cached.data,
          normalizedState: cached.normalized,
          validationResult: { valid: true, errors: [], warnings: [] },
          error: null,
          currentLevelId: url,
        });
        return true;
      }

      // Fetch
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load level: ${response.status} ${response.statusText}`);
      }

      const json = await response.json();
      return loadFromJSON(json, url);
    } catch (err) {
      setState({
        loadingState: 'error',
        levelData: null,
        normalizedState: null,
        validationResult: null,
        error: err instanceof Error ? err.message : 'Failed to load level from URL',
        currentLevelId: null,
      });
      return false;
    }
  }, [loadFromJSON]);

  /**
   * Load level from File object
   */
  const loadFromFile = useCallback(async (file: File): Promise<boolean> => {
    setState(prev => ({ ...prev, loadingState: 'loading', error: null }));

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      return loadFromJSON(json, file.name);
    } catch (err) {
      setState({
        loadingState: 'error',
        levelData: null,
        normalizedState: null,
        validationResult: null,
        error: err instanceof Error ? err.message : 'Failed to parse level file',
        currentLevelId: null,
      });
      return false;
    }
  }, [loadFromJSON]);

  /**
   * Clear current level
   */
  const clearLevel = useCallback(() => {
    setState({
      loadingState: 'idle',
      levelData: null,
      normalizedState: null,
      validationResult: null,
      error: null,
      currentLevelId: null,
    });
    currentUrlRef.current = null;
  }, []);

  /**
   * Reload current level
   */
  const reloadCurrent = useCallback(async (): Promise<boolean> => {
    if (state.currentLevelId && levelCache.has(state.currentLevelId)) {
      levelCache.delete(state.currentLevelId);
    }

    if (currentUrlRef.current) {
      return loadFromURL(currentUrlRef.current);
    } else if (state.levelData) {
      return loadFromJSON(state.levelData, state.currentLevelId || undefined);
    }

    return false;
  }, [state.currentLevelId, state.levelData, loadFromURL, loadFromJSON]);

  /**
   * Check if current level is valid
   */
  const isValid = useCallback((): boolean => {
    return state.validationResult?.valid === true;
  }, [state.validationResult]);

  /**
   * Get formatted validation report
   */
  const getValidationReport = useCallback((): string => {
    if (!state.validationResult) {
      return 'No level loaded';
    }
    return formatValidationErrors(state.validationResult);
  }, [state.validationResult]);

  /**
   * Get list of cached level IDs
   */
  const getCachedLevels = useCallback((): string[] => {
    const keys: string[] = [];
    levelCache.forEach((_, key) => keys.push(key));
    return keys;
  }, []);

  /**
   * Clear all cached levels
   */
  const clearCache = useCallback(() => {
    levelCache.clear();
  }, []);

  return {
    // State
    loadingState: state.loadingState,
    levelData: state.levelData,
    normalizedState: state.normalizedState,
    validationResult: state.validationResult,
    error: state.error,
    currentLevelId: state.currentLevelId,

    // Actions
    loadFromJSON,
    loadFromURL,
    loadFromFile,
    clearLevel,
    reloadCurrent,

    // Utilities
    isValid,
    getValidationReport,
    getCachedLevels,
    clearCache,
  };
}

export default useLevel;
