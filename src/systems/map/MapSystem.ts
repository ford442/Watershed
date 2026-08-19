/**
 * MapSystem.ts - Core map chunk management for Watershed
 *
 * RESPONSIBILITIES:
 * - Define base chunk interface for all biomes
 * - Handle chunk lifecycle (load/update/unload)
 * - Coordinate chunk treadmill based on player position
 * - Load and parse JSON level files
 *
 * Types and path/spawn generation live in sibling modules and are re-exported
 * here so existing `from '../map/MapSystem'` imports stay stable.
 *
 * SWARM: Extend BaseMapChunk for new biome-specific data
 */

import * as THREE from 'three';
import { normalizeBiomeId } from '../../configs/biomes';
import type {
  BaseMapChunk,
  LevelData,
  LevelSegment,
  MapConfig,
  MapManager,
  SegmentProgressionConfig,
  SegmentRange,
} from './MapSystem.types';
import {
  buildProceduralSegment,
  calculateSegmentSpawns,
  DEFAULT_MAP_CONFIG,
  DEFAULT_SEGMENT_PROGRESSION,
} from './MapSystem.generation';

// Re-export types and generation helpers (public API unchanged).
export type {
  BaseMapChunk,
  DecorationPlacement,
  LaunchShelfConfig,
  LevelData,
  LevelMetadata,
  LevelSegment,
  LevelSpawns,
  LevelWorld,
  MapConfig,
  MapManager,
  SegmentProgressionConfig,
  SegmentRange,
  SpawnData,
  VortexConfig,
} from './MapSystem.types';

export {
  buildProceduralSegment,
  calculateSegmentSpawns,
  calculateSpawns,
  DEFAULT_MAP_CONFIG,
  DEFAULT_SEGMENT_PROGRESSION,
  ensureTangentContinuity,
  generateRiverPath,
  generateSegmentPath,
  INITIAL_TREADMILL_POINTS,
  SeededRandom,
  type BuildProceduralSegmentOptions,
} from './MapSystem.generation';

// =============================================================================
// PLACEHOLDER IMPLEMENTATION
// =============================================================================

export class DefaultMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  private config: MapConfig;
  private nextChunkId = 0;
  private progression: SegmentRange[];

  constructor(config: Partial<MapConfig> = {}, progression: SegmentRange[] = []) {
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };
    this.progression = progression;

    // Generate initial chunks
    for (let i = 0; i < this.config.chunksAhead + 1; i++) {
      this.chunks.push(this.generateChunk(i, this.chunks[this.chunks.length - 1]));
    }
  }

  /**
   * Return the lightweight SegmentProgressionConfig for the given index.
   * Iterates the progression array with "first match wins" semantics, so
   * callers should place more-specific ranges before broader catch-alls.
   */
  getChunkConfig(index: number): SegmentProgressionConfig {
    const base: SegmentProgressionConfig = { ...DEFAULT_SEGMENT_PROGRESSION };
    for (const range of this.progression) {
      const to = range.indexTo ?? Infinity;
      if (index >= range.indexFrom && index <= to) {
        return { ...base, ...range.config };
      }
    }
    return base;
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    // Find chunk whose path contains this position
    return this.chunks.find(chunk => {
      if (!chunk.curve) return false;
      // Simple distance check to chunk center
      const dist = chunk.position.distanceTo(position);
      return dist < chunk.length;
    }) || null;
  }

  generateChunk(index: number, previousChunk?: BaseMapChunk): BaseMapChunk {
    const previousPoints = previousChunk?.pathPoints ?? null;
    const { chunk } = buildProceduralSegment(index, previousPoints, this, {
      seed: this.config.seed + index * 1000,
      ensureContinuity: !!previousChunk,
    });
    chunk.id = `chunk-${this.nextChunkId++}`;
    return chunk;
  }

  update(playerPosition: THREE.Vector3): void {
    // Find current chunk
    const currentChunk = this.getChunkAtPosition(playerPosition);
    if (currentChunk) {
      this.currentChunkIndex = currentChunk.index;
    }

    // Generate ahead if needed
    const maxIndex = Math.max(...this.chunks.map(c => c.index), 0);
    if (maxIndex < this.currentChunkIndex + this.config.chunksAhead) {
      const previousChunk = this.chunks.find(c => c.index === maxIndex);
      this.chunks.push(this.generateChunk(maxIndex + 1, previousChunk));
    }

    // Remove far behind chunks
    this.chunks = this.chunks.filter(chunk =>
      chunk.index >= this.currentChunkIndex - this.config.chunksBehind
    );
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    const chunk = this.getChunkAtPosition(position);
    if (!chunk?.curve) return new THREE.Vector3(0, 0, -1);

    // Find closest point on curve
    // Note: getUtoTmapping is expensive, consider caching
    const tangent = chunk.curve.getTangent(0.5); // Simplified
    return tangent;
  }
}

// =============================================================================
// BIOME NAME MAPPING (map-load only)
// =============================================================================

/**
 * @deprecated Use normalizeBiomeId from configs/biomes.ts.
 * Kept as a re-export of LEGACY_BIOME_ALIASES for one-release compatibility.
 */
export { LEGACY_BIOME_ALIASES as JSON_BIOME_NAME_MAP, normalizeBiomeId } from '../../configs/biomes';

// =============================================================================
// JSON LEVEL LOADER
// =============================================================================

/**
 * Loads and parses JSON level files into MapSystem-compatible format
 */
export class JSONLevelLoader {
  /**
   * Fetch and parse a level from URL
   */
  static async loadFromUrl(url: string): Promise<LevelData> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load level: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return this.validateAndNormalize(data);
  }

  /**
   * Parse level data from object (already loaded JSON)
   */
  static loadFromObject(data: any): LevelData {
    return this.validateAndNormalize(data);
  }

  /**
   * Validate and normalize level data
   */
  private static validateAndNormalize(data: any): LevelData {
    if (!data.metadata || !data.world || !data.segments || !data.spawns) {
      throw new Error('Invalid level data: missing required sections (metadata, world, segments, spawns)');
    }

    // Ensure segments are sorted by index
    const segments = [...data.segments].sort((a: LevelSegment, b: LevelSegment) => a.index - b.index);

    // Normalize waypoints to Vector3
    const waypoints = data.world.track.waypoints.map((wp: number[]) =>
      new THREE.Vector3(wp[0], wp[1], wp[2])
    );

    // Create the main curve from waypoints
    const mainCurve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);

    return {
      metadata: data.metadata,
      world: {
        ...data.world,
        track: {
          ...data.world.track,
          waypoints,
        },
      },
      segments,
      spawns: data.spawns,
      decorationPools: data.decorationPools,
    } as LevelData;
  }
}

// =============================================================================
// JSON-DRIVEN MAP MANAGER
// =============================================================================

/**
 * MapManager that loads chunks from JSON level data
 * Replaces inline generation with JSON-driven authoring
 */
export class JSONMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  levelData: LevelData | null = null;
  private mainCurve: THREE.CatmullRomCurve3 | null = null;
  private nextChunkId = 0;
  private fallbackManager: DefaultMapManager;

  /**
   * @param levelData - Parsed JSON level to serve authored segments from.
   * @param fallbackProgression - SegmentRange table used for indices beyond
   *   totalSegments. Defaults to an empty table (yields DEFAULT_SEGMENT_PROGRESSION).
   *   Prefer passing the map's authored fallback so the same progression table
   *   governs both direct JSONMapManager callers and ProceduralMapManager wrappers.
   */
  constructor(levelData?: LevelData, fallbackProgression: SegmentRange[] = []) {
    this.fallbackManager = new DefaultMapManager({}, fallbackProgression);
    if (levelData) {
      this.loadLevel(levelData);
    }
  }

  /**
   * Load a new level
   */
  loadLevel(levelData: LevelData): void {
    this.levelData = levelData;
    this.chunks = [];
    this.currentChunkIndex = 0;
    this.nextChunkId = 0;

    // Create main curve from waypoints
    const waypoints = levelData.world.track.waypoints as unknown as THREE.Vector3[];
    this.mainCurve = new THREE.CatmullRomCurve3(waypoints, false, 'catmullrom', 0.5);

    // Generate initial chunks
    const initialCount = Math.min(3, levelData.world.track.totalSegments);
    for (let i = 0; i < initialCount; i++) {
      this.chunks.push(this.generateChunk(i));
    }
  }

  /**
   * Load level from URL
   */
  async loadFromUrl(url: string): Promise<void> {
    const levelData = await JSONLevelLoader.loadFromUrl(url);
    this.loadLevel(levelData);
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    return this.chunks.find(chunk => {
      if (!chunk.curve) return false;
      const dist = chunk.position.distanceTo(position);
      return dist < chunk.length * 0.6;
    }) || null;
  }

  generateChunk(index: number): BaseMapChunk {
    if (!this.levelData || !this.mainCurve) {
      throw new Error('No level loaded');
    }

    const segmentConfig = this.levelData.segments.find(s => s.index === index);
    const totalSegments = this.levelData.world.track.totalSegments;

    if (!segmentConfig && index < totalSegments) {
      console.warn(`[MapSystem] No config for segment ${index}, using defaults`);
    }

    const config = segmentConfig || {
      index,
      difficulty: 0.5,
      type: 'normal' as const,
    };

    // Calculate segment bounds along the main curve
    const tStart = index / totalSegments;
    const tEnd = (index + 1) / totalSegments;

    // Sample points along curve for this segment
    const pathPoints: THREE.Vector3[] = [];
    const numPoints = 4;
    for (let i = 0; i < numPoints; i++) {
      const t = tStart + (tEnd - tStart) * (i / (numPoints - 1));
      pathPoints.push(this.mainCurve!.getPoint(Math.min(1, t)));
    }

    // Create segment curve
    const curve = new THREE.CatmullRomCurve3(
      pathPoints,
      false,
      'catmullrom',
      config.type === 'pond' ? 0.1 : 0.5
    );
    const pathLength = curve.getLength();
    const centerPoint = curve.getPoint(0.5);

    // Calculate spawns from the authored progression config
    const progression = this.getChunkConfig(index);
    const seed = 12345 + index * 1000;
    const spawns = calculateSegmentSpawns(curve, progression, index, seed);

    // Map biome type
    const biomeOverride = config.biomeOverride || this.levelData.world.biome.baseType;

    const chunk: BaseMapChunk = {
      id: `chunk-${this.nextChunkId++}`,
      index,
      position: centerPoint,
      pathPoints,
      curve,
      length: pathLength,
      biome: normalizeBiomeId(biomeOverride),
      flowSpeed: config.physics?.waterFlowIntensity || this.levelData.world.biome.water.flowSpeed,
      waterLevel: 0.5,
      waterWidth: config.waterWidth ?? this.levelData.world.track.width ?? DEFAULT_MAP_CONFIG.waterWidth,
      canyonWidth: config.width || this.levelData.world.track.width || DEFAULT_MAP_CONFIG.canyonWidth,
      spawns,
      config:
        progression.decorations ||
        progression.launchShelf ||
        progression.openFloor ||
        progression.hasBridge ||
        progression.vortex
          ? {
              decorations: progression.decorations,
              launchShelf: progression.launchShelf,
              openFloor: progression.openFloor,
              hasBridge: progression.hasBridge,
              vortex: progression.vortex,
            }
          : undefined,
      active: true,
    };

    return chunk;
  }

  update(playerPosition: THREE.Vector3): void {
    const currentChunk = this.getChunkAtPosition(playerPosition);
    if (currentChunk) {
      this.currentChunkIndex = currentChunk.index;
    }

    // Generate ahead if needed and within level bounds
    if (this.levelData) {
      const maxIndex = Math.max(...this.chunks.map(c => c.index), 0);
      const totalSegments = this.levelData.world.track.totalSegments;

      if (maxIndex < this.currentChunkIndex + 3 && maxIndex < totalSegments - 1) {
        this.chunks.push(this.generateChunk(maxIndex + 1));
      }
    }

    // Remove far behind chunks
    this.chunks = this.chunks.filter(chunk =>
      chunk.index >= this.currentChunkIndex - 1
    );
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    const chunk = this.getChunkAtPosition(position);
    if (!chunk?.curve) return new THREE.Vector3(0, 0, -1);
    return chunk.curve.getTangent(0.5);
  }

  /**
   * Map a LevelSegment entry to SegmentProgressionConfig.
   * Returns default values for any field not specified in the JSON.
   */
  getChunkConfig(index: number): SegmentProgressionConfig {
    const base: SegmentProgressionConfig = { ...DEFAULT_SEGMENT_PROGRESSION };
    if (!this.levelData) return this.fallbackManager.getChunkConfig(index);

    const totalSegments = this.levelData.world.track.totalSegments;
    const seg = this.levelData.segments.find(s => s.index === index);

    // Segments beyond the authored range fall back to procedural generation
    if (!seg) {
      if (index >= totalSegments) {
        return this.fallbackManager.getChunkConfig(index);
      }
      // Segment within authored range but no explicit entry — use defaults
      return base;
    }

    // Map authored biome string to canonical BiomeId (legacy aliases at load only)
    const rawBiome = seg.biomeOverride ?? this.levelData.world.biome.baseType;
    const mappedBiome = normalizeBiomeId(rawBiome);

    // Derive rockDensity from decoration counts: >= 15 rocks → 'high'
    let rockDensity: SegmentProgressionConfig['rockDensity'] =
      seg.rockDensity ?? base.rockDensity;
    const rockDecorations = seg.decorations?.rocks;
    if (!seg.rockDensity && typeof rockDecorations === 'number') {
      rockDensity = rockDecorations >= 15 ? 'high' : 'low';
    }

    return {
      ...base,
      biome: mappedBiome,
      type: seg.type ?? base.type,
      width: seg.width ?? base.width,
      waterWidth: seg.waterWidth ?? base.waterWidth,
      meanderStrength: seg.meanderStrength ?? base.meanderStrength,
      verticalBias: seg.verticalBias ?? base.verticalBias,
      flowSpeed: seg.physics?.waterFlowIntensity ?? base.flowSpeed,
      treeDensity:
        seg.treeDensity ??
        (typeof seg.decorations?.trees === 'number'
          ? seg.decorations.trees
          : base.treeDensity),
      rockDensity,
      forwardMomentum: seg.forwardMomentum,
      particleCount: seg.effects?.particleCount,
      cameraShake: seg.effects?.cameraShake,
      gravityMultiplier: seg.physics?.gravityMultiplier,
      decorations: seg.decorations,
      launchShelf: seg.launchShelf,
      journeyComplete: seg.journeyComplete,
      forceVehicle: seg.forceVehicle,
      slipperiness: seg.slipperiness,
      openFloor: seg.openFloor,
      hasBridge: seg.hasBridge,
      vortex: seg.vortex,
    };
  }
}

// =============================================================================
// PROCEDURAL MAP MANAGER (JSON-authored config + procedural treadmill paths)
// =============================================================================

/**
 * Combines JSON level segment configs with procedural path generation.
 * Authored segments resolve via JSONMapManager.getChunkConfig; indices beyond
 * the authored sequence fall back to DefaultMapManager progression ranges.
 */
export class ProceduralMapManager implements MapManager {
  chunks: BaseMapChunk[] = [];
  currentChunkIndex = 0;
  private config: MapConfig;
  private levelData: LevelData | null;
  private jsonManager: JSONMapManager | null;
  private continuationManager: JSONMapManager | null;
  private continuationStartIndex: number;
  private fallbackManager: DefaultMapManager;
  /** Global treadmill index where continuation levelData begins (primary totalSegments by default). */
  private continuationGlobalStart: number | null = null;
  /** Optional width/water overrides at the handoff seam (segmentOffset → blend). */
  private handoffWidthBlend: Map<number, { width: number; waterWidth: number }> = new Map();
  /**
   * When true, primary journeyComplete is suppressed so the treadmill can keep
   * generating into an attached handoff continuation. Initial registry
   * continuation must NOT set this — single-map hydro still needs its overlay.
   */
  private suppressTerminalComplete = false;

  constructor(
    levelData?: LevelData | null,
    fallbackProgression: SegmentRange[] = [],
    config: Partial<MapConfig> = {},
    continuation?: { levelData: LevelData; startIndex?: number } | null,
  ) {
    this.config = { ...DEFAULT_MAP_CONFIG, ...config };
    this.levelData = levelData ?? null;
    // Pass the authored fallback progression so JSONMapManager's own fallback
    // table is consistent with ProceduralMapManager's fallback (same object).
    this.jsonManager = levelData ? new JSONMapManager(levelData, fallbackProgression) : null;
    this.continuationManager = continuation?.levelData
      ? new JSONMapManager(continuation.levelData)
      : null;
    this.continuationStartIndex = continuation?.startIndex ?? 0;
    this.fallbackManager = new DefaultMapManager(config, fallbackProgression);

    if (levelData) {
      const total = levelData.world.track.totalSegments;
      const segCount = levelData.segments.length;
      console.log(
        `[MapSystem] ProceduralMapManager bound to "${levelData.metadata.name}" ` +
        `(${segCount} authored segments, totalSegments=${total}, ` +
        `fallback ranges: ${fallbackProgression.length})`,
      );
    }
  }

  /** Authored segment count of the primary map (0 when procedural-only). */
  getPrimarySegmentCount(): number {
    return this.levelData?.world.track.totalSegments ?? 0;
  }

  /**
   * Number of *explicit* authored segment entries in the JSON (may be less than
   * `totalSegments` when some indices rely on defaults).
   */
  getExplicitSegmentCount(): number {
    return this.levelData?.segments.length ?? 0;
  }

  /**
   * Attach or replace the continuation map used when the primary authored range
   * is exhausted. Does not reset the treadmill — call from seamless handoff.
   */
  attachContinuation(
    continuation: { levelData: LevelData; startIndex?: number },
    options?: {
      globalStartIndex?: number;
      widthBlend?: Array<{ segmentOffset: number; width: number; waterWidth: number }>;
    },
  ): void {
    this.continuationManager = new JSONMapManager(continuation.levelData);
    this.continuationStartIndex = continuation.startIndex ?? 0;
    this.continuationGlobalStart =
      options?.globalStartIndex ?? this.getPrimarySegmentCount();
    this.suppressTerminalComplete = true;
    this.handoffWidthBlend.clear();
    for (const step of options?.widthBlend ?? []) {
      this.handoffWidthBlend.set(step.segmentOffset, {
        width: step.width,
        waterWidth: step.waterWidth,
      });
    }
  }

  getChunkConfig(index: number): SegmentProgressionConfig {
    if (this.jsonManager && this.levelData) {
      const totalSegments = this.levelData.world.track.totalSegments;
      const hasExplicit = this.levelData.segments.some((segment) => segment.index === index);
      if (hasExplicit || index < totalSegments) {
        const cfg = this.jsonManager.getChunkConfig(index);
        if (this.suppressTerminalComplete && cfg.journeyComplete) {
          return { ...cfg, journeyComplete: false };
        }
        return cfg;
      }
      if (this.continuationManager) {
        const globalStart = this.continuationGlobalStart ?? totalSegments;
        const continuationIndex =
          this.continuationStartIndex + (index - globalStart);
        const cfg = this.continuationManager.getChunkConfig(continuationIndex);
        const blend = this.handoffWidthBlend.get(index - globalStart);
        if (blend) {
          return {
            ...cfg,
            width: blend.width,
            waterWidth: blend.waterWidth,
            journeyComplete: false,
          };
        }
        return {
          ...cfg,
          journeyComplete: index - globalStart === 0 ? false : cfg.journeyComplete,
        };
      }
    }
    return this.fallbackManager.getChunkConfig(index);
  }

  getChunkAtPosition(position: THREE.Vector3): BaseMapChunk | null {
    return this.fallbackManager.getChunkAtPosition(position);
  }

  generateChunk(index: number, previousChunk?: BaseMapChunk): BaseMapChunk {
    const previousPoints = previousChunk?.pathPoints ?? null;
    const { chunk } = buildProceduralSegment(index, previousPoints, this, {
      seed: this.config.seed + index * 1000,
      ensureContinuity: !!previousChunk,
    });
    return chunk;
  }

  update(playerPosition: THREE.Vector3): void {
    this.fallbackManager.update(playerPosition);
    this.chunks = this.fallbackManager.chunks;
    this.currentChunkIndex = this.fallbackManager.currentChunkIndex;
  }

  getFlowAtPosition(position: THREE.Vector3): THREE.Vector3 {
    return this.fallbackManager.getFlowAtPosition(position);
  }
}

// =============================================================================
// SIMPLE POOLING / CULLING UTILITIES
// =============================================================================

/**
 * Lightweight pool for reusing chunk objects instead of reallocating.
 * Biomes should call acquire() when creating and release() when recycling.
 *
 * // RAPTOR-MINI: plug this into biome managers for high-speed reuse.
 */
export class ChunkPool {
  private pool: BaseMapChunk[] = [];

  acquire(): BaseMapChunk {
    const chunk = this.pool.pop();
    if (chunk) {
      chunk.active = true;
      return chunk;
    }
    return {} as BaseMapChunk;
  }

  release(chunk: BaseMapChunk): void {
    chunk.active = false;
    delete chunk.curve;
    delete chunk.collider;
    this.pool.push(chunk);
  }

  get size(): number {
    return this.pool.length;
  }
}
