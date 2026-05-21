/**
 * useLevelEditor Hook
 *
 * Editor-specific state hook for level editing.
 * Distinct from useLevel.ts (runtime loader) — do NOT merge.
 *
 * Provides CRUD operations on EditorSegmentConfig[], plus
 * loadFromJSON (accepts meander_to_waterfall.json format) and
 * exportAsJSON (outputs LevelData-compatible JSON string).
 */

import { useState, useCallback } from 'react';
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EditorSegmentConfig {
  /** String identifier, e.g. "segment-0" */
  id: string;
  /** Zero-based sequence number */
  index: number;
  type: 'normal' | 'waterfall' | 'pond' | 'splash' | 'rapids';
  /** Resolved biome (biomeOverride ?? world biome) */
  biome: string;
  /** Per-segment biome override; undefined = inherit world biome */
  biomeOverride?: string;
  name?: string;
  startPoint: [number, number, number];
  endPoint: [number, number, number];
  /** Two intermediate control points for the segment curve */
  controlPoints: [number, number, number][];
  /** Canyon width; inherits from world track width when undefined */
  width?: number;
  /** Maps to meanderStrength in the JSON format */
  meanderAmount: number;
  verticalBias: number;
  forwardMomentum: number;
  /** Shorthand rock count from decorations.rocks */
  rockDensity: number;
  /** All decorations as plain counts (arrays are collapsed to length) */
  decorations: Record<string, number>;
  difficulty: number;
  /** Approximate arc length in world units */
  length: number;
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

export interface UseLevelEditorReturn {
  segments: EditorSegmentConfig[];
  selectedSegment: EditorSegmentConfig | null;
  selectSegment: (id: string | null) => void;
  updateSegment: (id: string, updates: Partial<EditorSegmentConfig>) => void;
  addSegment: (overrides?: Partial<EditorSegmentConfig>) => EditorSegmentConfig;
  removeSegment: (id: string) => void;
  /** Accepts meander_to_waterfall.json (LevelData) format */
  loadFromJSON: (data: any) => void;
  /** Serialises current state as LevelData-compatible JSON string */
  exportAsJSON: () => string;

  // Additional derived state needed by editor UI
  /** Track waypoints extracted from the loaded JSON */
  waypoints: [number, number, number][];
  /** World-level base biome */
  worldBiome: string;
  /** Level display name */
  levelName: string;
  /** Default canyon width from world.track.width */
  levelWidth: number;
  /** True once at least one segment is present */
  isLoaded: boolean;
  /** Update the world biome and re-resolve all segments */
  setWorldBiome: (biome: string) => void;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function vec3ToTuple(v: THREE.Vector3): [number, number, number] {
  return [v.x, v.y, v.z];
}

function normalizeDecorations(raw: any): Record<string, number> {
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.length;
    }
  }
  return out;
}

function buildSegmentFromRaw(
  seg: any,
  curve: THREE.CatmullRomCurve3,
  totalSegments: number,
  worldBiome: string,
  worldWidth: number,
): EditorSegmentConfig {
  const tStart = seg.index / totalSegments;
  const tEnd = Math.min(1, (seg.index + 1) / totalSegments);

  const startPt = curve.getPoint(tStart);
  const endPt = curve.getPoint(tEnd);

  const t1 = tStart + (tEnd - tStart) * 0.333;
  const t2 = tStart + (tEnd - tStart) * 0.667;

  // Approximate arc length for this segment (chord from 10 samples)
  let length = 0;
  let prev = startPt.clone();
  for (let i = 1; i <= 10; i++) {
    const t = tStart + (tEnd - tStart) * (i / 10);
    const cur = curve.getPoint(t);
    length += prev.distanceTo(cur);
    prev = cur;
  }

  const decorations = normalizeDecorations(seg.decorations);

  return {
    id: `segment-${seg.index}`,
    index: seg.index,
    type: seg.type ?? 'normal',
    biome: seg.biomeOverride ?? worldBiome,
    biomeOverride: seg.biomeOverride,
    name: seg.name,
    startPoint: vec3ToTuple(startPt),
    endPoint: vec3ToTuple(endPt),
    controlPoints: [vec3ToTuple(curve.getPoint(t1)), vec3ToTuple(curve.getPoint(t2))],
    width: seg.width ?? seg.waterWidth ?? worldWidth,  // seg.waterWidth: legacy field name in older map JSON
    meanderAmount: seg.meanderStrength ?? 1.0,
    verticalBias: seg.verticalBias ?? -0.5,
    forwardMomentum: seg.forwardMomentum ?? 1.0,
    rockDensity: typeof decorations.rocks === 'number' ? decorations.rocks : 0,
    decorations,
    difficulty: seg.difficulty ?? 0.3,
    length,
    physics: seg.physics,
    safeZone: seg.safeZone,
    effects: seg.effects,
  };
}

// ---------------------------------------------------------------------------
// Internal state shape
// ---------------------------------------------------------------------------

interface EditorState {
  segments: EditorSegmentConfig[];
  selectedId: string | null;
  waypoints: [number, number, number][];
  worldBiome: string;
  levelName: string;
  levelWidth: number;
  /** Original JSON kept for round-trip export (metadata, spawns, world) */
  rawData: any | null;
}

const DEFAULT_STATE: EditorState = {
  segments: [],
  selectedId: null,
  waypoints: [],
  worldBiome: 'creek-summer',
  levelName: 'Untitled Level',
  levelWidth: 35,
  rawData: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLevelEditor(): UseLevelEditorReturn {
  const [state, setState] = useState<EditorState>(DEFAULT_STATE);

  // ---- loadFromJSON --------------------------------------------------------

  const loadFromJSON = useCallback((data: any) => {
    try {
      const rawWaypoints: number[][] = data.world.track.waypoints;
      const waypoints: [number, number, number][] = rawWaypoints.map(
        (wp) => [wp[0], wp[1], wp[2]] as [number, number, number],
      );

      const points = waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z));
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);

      const worldBiome: string = data.world.biome.baseType;
      const totalSegments: number = data.world.track.totalSegments;
      const worldWidth: number = data.world.track.width ?? 35;

      const segments: EditorSegmentConfig[] = (data.segments as any[]).map((seg) =>
        buildSegmentFromRaw(seg, curve, totalSegments, worldBiome, worldWidth),
      );

      setState({
        segments,
        selectedId: segments.length > 0 ? segments[0].id : null,
        waypoints,
        worldBiome,
        levelName: data.metadata?.name ?? 'Untitled Level',
        levelWidth: worldWidth,
        rawData: data,
      });
    } catch (err) {
      console.error('[useLevelEditor] loadFromJSON failed:', err);
    }
  }, []);

  // ---- selectSegment -------------------------------------------------------

  const selectSegment = useCallback((id: string | null) => {
    setState((prev) => ({ ...prev, selectedId: id }));
  }, []);

  // ---- updateSegment -------------------------------------------------------

  const updateSegment = useCallback(
    (id: string, updates: Partial<EditorSegmentConfig>) => {
      setState((prev) => ({
        ...prev,
        segments: prev.segments.map((s) => (s.id === id ? { ...s, ...updates } : s)),
      }));
    },
    [],
  );

  // ---- addSegment ----------------------------------------------------------

  const addSegment = useCallback(
    (overrides?: Partial<EditorSegmentConfig>): EditorSegmentConfig => {
      // Build the new segment outside setState so we can return it synchronously.
      // The index is derived from the current snapshot via a temporary ref pattern —
      // we use the length at the time of the call as a best-effort index.
      const defaultSeg: Omit<EditorSegmentConfig, 'id' | 'index' | 'biome'> = {
        type: 'normal',
        startPoint: [0, 0, 0],
        endPoint: [0, -5, -50],
        controlPoints: [
          [0, -2, -17],
          [0, -3, -33],
        ],
        meanderAmount: 1.0,
        verticalBias: -0.5,
        forwardMomentum: 1.0,
        rockDensity: 0,
        decorations: {},
        difficulty: 0.3,
        length: 50,
        ...overrides,
      };

      let created: EditorSegmentConfig = {
        id: 'segment-pending',
        index: 0,
        biome: 'creek-summer',
        ...defaultSeg,
      };

      setState((prev) => {
        const idx = prev.segments.length;
        const base: EditorSegmentConfig = {
          ...defaultSeg,
          id: `segment-${idx}`,
          index: idx,
          biome: prev.worldBiome,
          width: prev.levelWidth,
        };
        created = base;
        return {
          ...prev,
          segments: [...prev.segments, base],
          selectedId: base.id,
        };
      });

      return created;
    },
    [],
  );

  // ---- removeSegment -------------------------------------------------------

  const removeSegment = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      segments: prev.segments.filter((s) => s.id !== id),
      selectedId: prev.selectedId === id ? null : prev.selectedId,
    }));
  }, []);

  // ---- setWorldBiome -------------------------------------------------------

  const setWorldBiome = useCallback((biome: string) => {
    setState((prev) => ({
      ...prev,
      worldBiome: biome,
      segments: prev.segments.map((s) =>
        s.biomeOverride
          ? s
          : { ...s, biome },
      ),
    }));
  }, []);

  // ---- exportAsJSON --------------------------------------------------------

  const exportAsJSON = useCallback((): string => {
    const { segments, rawData, waypoints, worldBiome, levelName, levelWidth } = state;

    const exported = {
      metadata: rawData?.metadata ?? {
        name: levelName,
        author: 'editor',
        difficulty: 'beginner',
        estimatedDuration: 120,
        version: '1.0.0',
      },
      world: rawData?.world ?? {
        track: {
          waypoints,
          segmentLength: 100,
          totalSegments: segments.length,
          width: levelWidth,
        },
        biome: {
          baseType: worldBiome,
          sky: { color: '#87ceeb', cloudDensity: 0.4 },
          fog: { color: '#a5d6ff', near: 20, far: 150 },
          lighting: { sunIntensity: 1.2, sunAngle: 45 },
          water: { tint: '#4a90d9', flowSpeed: 1.0 },
        },
      },
      segments: segments.map((seg) => ({
        index: seg.index,
        ...(seg.name ? { name: seg.name } : {}),
        ...(seg.type !== 'normal' ? { type: seg.type } : {}),
        ...(seg.biomeOverride ? { biomeOverride: seg.biomeOverride } : {}),
        difficulty: seg.difficulty,
        ...(seg.width !== undefined ? { width: seg.width } : {}),
        meanderStrength: seg.meanderAmount,
        verticalBias: seg.verticalBias,
        forwardMomentum: seg.forwardMomentum,
        ...(Object.keys(seg.decorations).length > 0 ? { decorations: seg.decorations } : {}),
        ...(seg.physics ? { physics: seg.physics } : {}),
        ...(seg.safeZone ? { safeZone: seg.safeZone } : {}),
        ...(seg.effects ? { effects: seg.effects } : {}),
      })),
      spawns: rawData?.spawns ?? {
        start: { position: [0, -4, -10], rotation: [0, 0, 0] },
      },
    };

    return JSON.stringify(exported, null, 2);
  }, [state]);

  // ---- derived -------------------------------------------------------------

  const selectedSegment =
    state.segments.find((s) => s.id === state.selectedId) ?? null;

  return {
    segments: state.segments,
    selectedSegment,
    selectSegment,
    updateSegment,
    addSegment,
    removeSegment,
    loadFromJSON,
    exportAsJSON,
    waypoints: state.waypoints,
    worldBiome: state.worldBiome,
    levelName: state.levelName,
    levelWidth: state.levelWidth,
    isLoaded: state.segments.length > 0,
    setWorldBiome,
  };
}

export default useLevelEditor;
