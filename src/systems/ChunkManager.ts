/**
 * ChunkManager.ts — Treadmill segment orchestration for Watershed
 *
 * RESPONSIBILITIES:
 * - Maintain a fixed-size object pool of track segments
 * - Generate new segments ahead of the player (Catmull-Rom splines)
 * - Recycle old segments behind the player
 * - Detect biome transitions based on closest active segment
 * - Track spawn points for segment-index-aware respawn
 *
 * ARCHITECTURE:
 * - Pure TypeScript class, no React dependencies
 * - TrackManager.tsx creates an instance and calls update() inside useFrame
 * - All NaN guards and tangent-continuity fixes from TrackManager are preserved
 */

import * as THREE from 'three';
import { GENERATION } from '../constants/game';
import { getTrackBiomeProfile, TrackBiomeProfile } from '../configs/TrackBiomes';
import {
  MapManager,
  buildProceduralSegment,
  ChunkPool,
  ensureTangentContinuity,
  INITIAL_TREADMILL_POINTS,
  type BaseMapChunk,
  type DecorationPlacement,
  type SpawnData,
  type SegmentProgressionConfig,
} from './MapSystem';
import type { NormalizedSegment } from './ReachNormalizer';

// =============================================================================
// TYPES
// =============================================================================

export interface SegmentData {
  id: number;
  type: string;
  biome: string;
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
  /** Authored decoration / launch-shelf overrides passed through to TrackSegment. */
  config?: {
    decorations?: Record<string, number | DecorationPlacement[]>;
    launchShelf?: { rockRef: { localX: number; localZ: number; scale: number } };
  };
  /** Backing MapSystem chunk for pool recycling. */
  _baseChunk?: BaseMapChunk;
}

export interface RenderedSlot {
  slotIndex: number;
  active: boolean;
  segment: SegmentData | null;
}

export interface ChunkManagerCallbacks {
  onPoolChange?: () => void;
  onBiomeChange?: (biome: string, segmentIndex: number) => void;
  onSegmentEnter?: (segmentIndex: number) => void;
}

export interface ChunkManagerOptions {
  mapManager: MapManager;
  reachSegments?: NormalizedSegment[] | null;
  forecastByIndex?: Map<number, string>;
  callbacks?: ChunkManagerCallbacks;
  /**
   * Segment index to begin pool initialisation from.
   * Defaults to 0 (summer meander start). Set to GLACIER_START_INDEX (-5)
   * to chain the glacier prelude before the meander.
   */
  startIndex?: number;
  /** Base procedural seed (`?seed=` override or default map seed). */
  proceduralBaseSeed?: number;
}

export interface ChunkManagerStats {
  active: number;
  total: number;
  nextId: number;
  spawnPointsTracked: number;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const POOL_SIZE = GENERATION.POOL_SIZE;
const MAX_ACTIVE_SEGMENTS = GENERATION.MAX_ACTIVE_SEGMENTS;
const GENERATION_THRESHOLD = GENERATION.THRESHOLD;
const RECYCLE_MARGIN = GENERATION.RECYCLE_MARGIN;

// =============================================================================
// SEGMENT GENERATION
// =============================================================================

function baseChunkToSegmentData(
  chunk: BaseMapChunk,
  progression: SegmentProgressionConfig,
  forecastState: string,
): SegmentData {
  const biomeProfile = getTrackBiomeProfile(progression.biome);
  const forecastBoost =
    forecastState === 'Flooded' ? 1.45 : forecastState === 'HighFlow' ? 1.2 : 1;

  return {
    id: chunk.index,
    type: forecastState === 'Flooded' && progression.type === 'normal' ? 'pond' : progression.type,
    biome: biomeProfile.id === 'slotCanyon' ? 'slotCanyon' : progression.biome,
    points: chunk.pathPoints,
    segmentPath: chunk.curve!,
    width: progression.width,
    waterWidth: progression.waterWidth,
    flowSpeed: progression.flowSpeed * forecastBoost,
    particleCount: progression.particleCount || 0,
    cameraShake: progression.cameraShake || 0,
    treeDensity: progression.treeDensity,
    rockDensity: progression.rockDensity,
    segmentState: forecastState,
    wallProfile: biomeProfile,
    forwardMomentum: progression.forwardMomentum,
    meanderStrength: progression.meanderStrength,
    verticalBias: progression.verticalBias,
    gravityMultiplier: progression.gravityMultiplier,
    spawns: chunk.spawns,
    config: chunk.config,
    _baseChunk: chunk,
  };
}

function createSegmentData(
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

// =============================================================================
// CHUNK MANAGER CLASS
// =============================================================================

export class ChunkManager {
  private pool: RenderedSlot[] = [];
  private activeOrder: number[] = [];
  private nextSegmentId = 0;
  private initialized = false;
  private mapManager: MapManager;
  private reachSegments: NormalizedSegment[] | null;
  private forecastByIndex: Map<number, string>;
  private callbacks: ChunkManagerCallbacks;
  private lastReportedBiome = 'summer';
  private spawnPoints = new Map<number, THREE.Vector3>();
  private lastEnteredSegment = -1;
  private biomeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingBiome: string | null = null;
  private startIndex: number;
  private proceduralBaseSeed?: number;
  private chunkPool = new ChunkPool();

  constructor(options: ChunkManagerOptions) {
    this.mapManager = options.mapManager;
    this.reachSegments = options.reachSegments ?? null;
    this.forecastByIndex = options.forecastByIndex ?? new Map();
    this.callbacks = options.callbacks ?? {};
    this.startIndex = options.startIndex ?? 0;
    this.proceduralBaseSeed = options.proceduralBaseSeed;
  }

  // ---------------------------------------------------------------------------
  // Pool lifecycle
  // ---------------------------------------------------------------------------

  initializePool(): void {
    const pool: RenderedSlot[] = Array.from(
      { length: POOL_SIZE },
      (_, slotIndex) => ({ slotIndex, active: false, segment: null })
    );
    let previousSegment: SegmentData | null = null;
    const activeOrder: number[] = [];
    const segments = this.reachSegments;

    for (let i = 0; i < MAX_ACTIVE_SEGMENTS; i += 1) {
      // startIndex allows the pool to begin at a negative offset (glacier prelude)
      const index = this.startIndex + i;
      // reachSegments are always 0-based; only use them for non-negative indices
      const reachIdx = index - this.startIndex;
      const segment: SegmentData =
        segments && index >= 0 && segments[reachIdx]
          ? this.adaptReachSegment(segments[reachIdx], previousSegment)
          : this.buildSegment(index, previousSegment);

      pool[i] = { slotIndex: i, active: true, segment };
      activeOrder.push(i);
      previousSegment = segment;
      this.nextSegmentId = index + 1;

      if (segment) {
        const sp = segment.segmentPath.getPoint(0);
        this.spawnPoints.set(segment.id, sp);
        window.dispatchEvent(
          new CustomEvent('segment-spawn', {
            detail: { segmentIndex: segment.id, spawnPoint: { x: sp.x, y: sp.y, z: sp.z } },
          })
        );
      }
    }

    this.pool = pool;
    this.activeOrder = activeOrder;
    this.initialized = true;
    this.callbacks.onPoolChange?.();
  }

  reset(reachSegments?: NormalizedSegment[] | null): void {
    this.clearBiomeDebounce();
    this.reachSegments = reachSegments ?? null;
    this.initialized = false;
    this.nextSegmentId = this.startIndex;
    this.activeOrder = [];
    this.pool = Array.from({ length: POOL_SIZE }, (_, slotIndex) => ({
      slotIndex,
      active: false,
      segment: null,
    }));
    this.spawnPoints.clear();
    this.lastEnteredSegment = -1;
  }

  dispose(): void {
    this.clearBiomeDebounce();
    this.initialized = false;
    this.activeOrder = [];
    this.pool = [];
    this.spawnPoints.clear();
    this.lastEnteredSegment = -1;
  }

  // ---------------------------------------------------------------------------
  // Synthetic segment entry (for screenshot/teleport harnesses)
  // ---------------------------------------------------------------------------

  /**
   * Replay the segment-enter side effects for a target index.
   * Callers should invoke this once for every skipped index so that flow,
   * biome, audio and journey-complete state accumulate incrementally rather
   * than jumping cold. Updates lastEnteredSegment so real treadmill
   * progression does not double-fire.
   */
  synthesizeSegmentEnter(index: number): void {
    if (!this.initialized || index <= this.lastEnteredSegment) return;
    this.lastEnteredSegment = index;
    this.callbacks.onSegmentEnter?.(index);
  }

  getLastEnteredSegment(): number {
    return this.lastEnteredSegment;
  }

  // ---------------------------------------------------------------------------
  // Per-frame update
  // ---------------------------------------------------------------------------

  update(cameraZ: number): { poolChanged: boolean; biomeChanged?: string; segmentEntered?: number } {
    if (!this.initialized) {
      return { poolChanged: false };
    }

    let poolChanged = false;
    let biomeChanged: string | undefined;
    let segmentEntered: number | undefined;

    const pool = this.pool;
    const activeOrder = this.activeOrder;

    // Build active segments list for threshold checks
    const activeSegments = activeOrder
      .map((slotIndex) => pool[slotIndex]?.segment)
      .filter((s): s is SegmentData => s !== null);

    if (activeSegments.length === 0) {
      return { poolChanged: false };
    }

    const newestSegment = activeSegments[activeSegments.length - 1];
    const newestEndPoint = newestSegment.segmentPath.getPoint(1);

    // ---- Generation threshold: create new segment ahead ----
    if (cameraZ - newestEndPoint.z < GENERATION_THRESHOLD) {
      const currentActive = [...activeOrder];
      const slotToRecycle =
        currentActive.length >= MAX_ACTIVE_SEGMENTS
          ? currentActive.shift()
          : currentActive.length;

      if (slotToRecycle === undefined) {
        return { poolChanged: false };
      }

      const recycledSlot = pool[slotToRecycle];
      if (recycledSlot?.segment?._baseChunk) {
        this.chunkPool.release(recycledSlot.segment._baseChunk);
      }

      const previousSegment = activeSegments[activeSegments.length - 1];

      // Defensive epsilon guard: check for gaps between segments
      if (previousSegment) {
        const prevEnd = previousSegment.segmentPath.getPoint(1);
        const gap = prevEnd.distanceTo(newestEndPoint);
        if (gap > 0.001) {
          console.warn(
            `[ChunkManager] Handoff gap detected: ${gap.toFixed(4)} — proceeding with caution`
          );
        }
      }

      const nextIndex = this.nextSegmentId;
      const nextSegment = this.buildSegment(nextIndex, previousSegment, true);

      // Atomic pool swap
      pool[slotToRecycle] = {
        slotIndex: slotToRecycle,
        active: true,
        segment: nextSegment,
      };

      activeOrder.splice(0, 1);
      activeOrder.push(slotToRecycle);

      this.nextSegmentId += 1;
      poolChanged = true;

      // Track spawn point
      const spawnPoint = nextSegment.segmentPath.getPoint(0);
      this.spawnPoints.set(nextSegment.id, spawnPoint);

      // Broadcast spawn point for respawn system
      window.dispatchEvent(
        new CustomEvent('segment-spawn', {
          detail: { segmentIndex: nextSegment.id, spawnPoint: { x: spawnPoint.x, y: spawnPoint.y, z: spawnPoint.z } },
        })
      );

      // Detect segment entry
      if (nextIndex > this.lastEnteredSegment) {
        this.lastEnteredSegment = nextIndex;
        segmentEntered = nextIndex;
        this.callbacks.onSegmentEnter?.(nextIndex);
      }
    }

    // ---- Recycling check (oldest segment) ----
    const oldestSegment = activeSegments[0];
    if (
      oldestSegment &&
      cameraZ > oldestSegment.segmentPath.getPoint(1).z + RECYCLE_MARGIN
    ) {
      // The oldest segment is safely behind the player and remains eligible
      // for recycling on the next append — no explicit action needed here
      // because the slot will be reused in the generation block above.
    }

    // ---- Biome change detection ----
    let closestSegment: SegmentData | null = null;
    let closestDistance = Infinity;

    for (const segment of activeSegments) {
      const centerPoint = segment.segmentPath.getPoint(0.5);
      const distance = Math.abs(cameraZ - centerPoint.z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestSegment = segment;
      }
    }

    if (closestSegment && closestSegment.biome !== this.lastReportedBiome) {
      const newBiome = closestSegment.biome;
      const segmentIndex = closestSegment.id;

      // Debounce rapid biome toggles: wait 400ms before committing
      if (this.biomeDebounceTimer) {
        clearTimeout(this.biomeDebounceTimer);
      }
      this.pendingBiome = newBiome;
      this.biomeDebounceTimer = setTimeout(() => {
        if (this.pendingBiome === newBiome) {
          this.lastReportedBiome = newBiome;
          this.callbacks.onBiomeChange?.(newBiome, segmentIndex);
          window.dispatchEvent(
            new CustomEvent('biome-change', { detail: { biome: newBiome, segmentIndex } })
          );
        }
        this.pendingBiome = null;
      }, 400);

      biomeChanged = newBiome;
    }

    if (poolChanged) {
      this.callbacks.onPoolChange?.();
    }

    return { poolChanged, biomeChanged, segmentEntered };
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getActiveSegments(): SegmentData[] {
    return this.activeOrder
      .map((slotIndex) => this.pool[slotIndex]?.segment)
      .filter((s): s is SegmentData => s !== null);
  }

  getRenderedSlots(): RenderedSlot[] {
    const activeSet = new Set(this.activeOrder);
    return this.pool.map((slot) => ({
      slotIndex: slot.slotIndex,
      active: activeSet.has(slot.slotIndex) && slot.segment !== null,
      segment: slot.segment,
    }));
  }

  getSegmentIndexAtZ(z: number): number {
    const activeSegments = this.getActiveSegments();
    let closestIndex = -1;
    let closestDistance = Infinity;

    for (const segment of activeSegments) {
      const centerPoint = segment.segmentPath.getPoint(0.5);
      const distance = Math.abs(z - centerPoint.z);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = segment.id;
      }
    }

    return closestIndex;
  }

  getSegmentSpawnPoint(index: number): THREE.Vector3 | null {
    return this.spawnPoints.get(index) ?? null;
  }

  getStats(): ChunkManagerStats {
    return {
      active: this.activeOrder.length,
      total: this.pool.length,
      nextId: this.nextSegmentId,
      spawnPointsTracked: this.spawnPoints.size,
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  getCurrentBiome(): string {
    return this.lastReportedBiome;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private buildSegment(
    index: number,
    previousSegment: SegmentData | null,
    ensureContinuity = false
  ): SegmentData {
    const segments = this.reachSegments;
    if (segments && segments[index]) {
      return this.adaptReachSegment(segments[index], previousSegment);
    }

    const forecastState = this.forecastByIndex.get(index) || 'Normal';
    return createSegmentData(
      index,
      previousSegment,
      forecastState,
      this.mapManager,
      ensureContinuity,
      this.proceduralBaseSeed,
    );
  }

  private adaptReachSegment(
    seg: NormalizedSegment,
    previousSegment: SegmentData | null
  ): SegmentData {
    if (previousSegment?.points) {
      const continuousPoints = ensureTangentContinuity(
        previousSegment.points,
        seg.points.map((p) => p.clone())
      );
      const tension = seg.type === 'pond' ? 0.1 : 0.5;
      return {
        ...seg,
        points: continuousPoints,
        segmentPath: new THREE.CatmullRomCurve3(continuousPoints, false, 'catmullrom', tension),
      };
    }
    return seg as SegmentData;
  }

  // Allow external forecast updates without full reset
  setForecastByIndex(forecastByIndex: Map<number, string>): void {
    this.forecastByIndex = forecastByIndex;
  }

  setReachSegments(reachSegments: NormalizedSegment[] | null): void {
    this.reachSegments = reachSegments ?? null;
  }

  private clearBiomeDebounce(): void {
    if (this.biomeDebounceTimer) {
      clearTimeout(this.biomeDebounceTimer);
      this.biomeDebounceTimer = null;
    }
    this.pendingBiome = null;
  }
}

export default ChunkManager;
