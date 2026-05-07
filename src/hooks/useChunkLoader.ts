/**
 * useChunkLoader.ts — React hook that wraps ChunkManager for reactive state
 *
 * RESPONSIBILITIES:
 * - Instantiate and manage a ChunkManager lifecycle inside a React component
 * - Poll player position each frame to drive segment generation
 * - Expose reactive state for UI (active segments, loading status, segment count)
 *
 * DESIGN:
 * - Returns stable references to avoid unnecessary re-renders in consumers.
 * - Uses refs for the ChunkManager instance (does not change across renders).
 * - Triggers React state updates only when the pool actually changes.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ChunkManager, ChunkManagerCallbacks, RenderedSlot } from '../systems/ChunkManager';
import { MapManager } from '../systems/MapSystem';
import type { NormalizedSegment } from '../systems/ReachNormalizer';

export interface UseChunkLoaderOptions {
  mapManager: MapManager;
  reachSegments?: NormalizedSegment[] | null;
  forecastByIndex?: Map<number, string>;
  onBiomeChange?: (biome: string) => void;
  onSegmentEnter?: (segmentIndex: number) => void;
  /** Player rigid body ref — must have translation() method */
  playerRef: React.MutableRefObject<{ translation: () => { x: number; y: number; z: number } } | null>;
  /** Whether the chunk system is enabled */
  enabled?: boolean;
}

export interface UseChunkLoaderResult {
  /** Currently rendered pool slots */
  renderedSlots: RenderedSlot[];
  /** Only the active (visible) segments */
  activeSegments: import('../systems/ChunkManager').SegmentData[];
  /** True while the initial pool is being built */
  isInitializing: boolean;
  /** Total number of segments generated so far */
  segmentCount: number;
  /** Force a pool refresh (e.g., after forecast update) */
  refresh: () => void;
  /** Get the ChunkManager instance for imperative queries */
  getManager: () => ChunkManager;
}

export function useChunkLoader(options: UseChunkLoaderOptions): UseChunkLoaderResult {
  const {
    mapManager,
    reachSegments,
    forecastByIndex,
    onBiomeChange,
    onSegmentEnter,
    playerRef,
    enabled = true,
  } = options;

  const [poolVersion, setPoolVersion] = useState(0);
  const [isInitializing, setIsInitializing] = useState(true);

  const callbacksRef = useRef<ChunkManagerCallbacks>({
    onPoolChange: () => setPoolVersion((v) => v + 1),
    onBiomeChange,
    onSegmentEnter,
  });

  // Keep callbacks fresh without recreating ChunkManager
  useEffect(() => {
    callbacksRef.current = {
      onPoolChange: () => setPoolVersion((v) => v + 1),
      onBiomeChange,
      onSegmentEnter,
    };
  }, [onBiomeChange, onSegmentEnter]);

  const managerRef = useRef<ChunkManager | null>(null);

  // Lazy-initialize ChunkManager
  if (!managerRef.current) {
    managerRef.current = new ChunkManager({
      mapManager,
      reachSegments,
      forecastByIndex,
      callbacks: callbacksRef.current,
    });
  }

  const manager = managerRef.current;

  // Reset when reachSegments or mapManager changes fundamentally
  useEffect(() => {
    if (!enabled) return;

    manager.setReachSegments(reachSegments ?? null);
    manager.setForecastByIndex(forecastByIndex ?? new Map());

    // If already initialized, check if we need a hard reset
    if (manager.isInitialized() && reachSegments) {
      manager.reset(reachSegments);
      setIsInitializing(true);
    }
  }, [reachSegments, mapManager, enabled, manager, forecastByIndex]);

  // Initialize pool once on first enabled frame
  useEffect(() => {
    if (!enabled) return;
    if (!manager.isInitialized()) {
      manager.initializePool();
      setIsInitializing(false);
    }
  }, [enabled, manager]);

  // Per-frame update: poll player Z and drive generation / recycling
  useFrame(() => {
    if (!enabled || !manager.isInitialized() || !playerRef.current) return;

    const pos = playerRef.current.translation();
    const result = manager.update(pos.z);

    if (result.poolChanged) {
      setPoolVersion((v) => v + 1);
    }
  });

  const refresh = useCallback(() => {
    if (manager.isInitialized()) {
      setPoolVersion((v) => v + 1);
    }
  }, [manager]);

  const getManager = useCallback(() => manager, [manager]);

  // Derive reactive outputs from poolVersion bump
  const renderedSlots = manager.getRenderedSlots();
  const activeSegments = manager.getActiveSegments();
  const stats = manager.getStats();

  return {
    renderedSlots,
    activeSegments,
    isInitializing,
    segmentCount: stats.nextId,
    refresh,
    getManager,
  };
}

export default useChunkLoader;
