/**
 * ReachManager.tsx
 *
 * Orchestrates a single Reach lifecycle.
 * - Loads Reach manifest and assets in the background.
 * - Normalizes manifest data into TrackManager-compatible segments.
 * - Watches player progress and logs transition entry for future multi-Reach handoff.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import TrackManager from '../components/TrackManager';
import { ReachStreamer, ReachManifest } from './ReachStreamer';
import { normalizeReachManifest, NormalizedSegment } from './ReachNormalizer';
import { ErrorDisplay, LoadingDisplay } from './LevelLoader';

interface ReachManagerProps {
  /** Player / vehicle rigid body ref */
  playerRef: React.RefObject<any>;
  /** Biome change callback */
  onBiomeChange?: (biome: string) => void;
  /** Forecast samples for water flow override */
  forecastSamples?: any[];
  /** Reach identifier to load */
  reachId?: string;
}

export default function ReachManager({
  playerRef,
  onBiomeChange,
  forecastSamples = [],
  reachId = 'reach_01_alpine_source',
}: ReachManagerProps) {
  const [reachSegments, setReachSegments] = useState<NormalizedSegment[] | null>(null);
  const [manifest, setManifest] = useState<ReachManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const transitionLoggedRef = useRef(false);

  // Load the Reach on mount / reachId change
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setReachSegments(null);
      setManifest(null);
      transitionLoggedRef.current = false;

      try {
        const result = await ReachStreamer.preloadReach(reachId);
        if (cancelled) return;

        const forecastState =
          forecastSamples.length > 0 ? forecastSamples[0].state : 'Normal';
        const segments = normalizeReachManifest(result.manifest, undefined, forecastState);

        setManifest(result.manifest);
        setReachSegments(segments);
        console.log(`[ReachManager] Reach ${reachId} loaded with ${segments.length} segments.`);

        // Trigger initial biome callback if provided
        if (onBiomeChange && result.manifest.world?.biome?.baseType) {
          const biomeMap: Record<string, string> = {
            'creek-summer': 'summer',
            'creek-autumn': 'autumn',
            'alpine-spring': 'summer',
            'canyon-sunset': 'autumn',
            'midnight-mist': 'autumn',
          };
          onBiomeChange(biomeMap[result.manifest.world.biome.baseType] || 'summer');
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[ReachManager] Failed to load Reach ${reachId}:`, msg);
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [reachId, onBiomeChange, retryKey]);

  // Watch player position for transition entry
  useFrame(() => {
    if (!manifest || !reachSegments || reachSegments.length === 0) return;
    if (!playerRef.current) return;

    const playerPos = playerRef.current.translation
      ? playerRef.current.translation()
      : playerRef.current.position;
    if (!playerPos) return;

    const transitionIndex = manifest.transition.segmentIndex;
    const transitionSegment = reachSegments[transitionIndex];
    if (!transitionSegment) return;

    // Determine if player is inside the transition segment by checking Z bounds
    const segPoints = transitionSegment.points;
    const zMin = Math.min(...segPoints.map((p) => p.z));
    const zMax = Math.max(...segPoints.map((p) => p.z));

    const inTransition = playerPos.z <= zMax && playerPos.z >= zMin;

    if (inTransition && !transitionLoggedRef.current) {
      transitionLoggedRef.current = true;
      console.log(
        `[ReachManager] Player entered transition segment ${transitionIndex} (${manifest.transition.type}) of Reach ${reachId}`
      );
    } else if (!inTransition && transitionLoggedRef.current) {
      transitionLoggedRef.current = false;
      console.log(
        `[ReachManager] Player exited transition segment ${transitionIndex} of Reach ${reachId}`
      );
    }
  });

  if (loading) {
    return (
      <LoadingDisplay message={`Loading Reach: ${reachId}...`} />
    );
  }

  if (error) {
    return (
      <ErrorDisplay
        error={error}
        onRetry={() => {
          setError(null);
          setRetryKey((k) => k + 1);
        }}
      />
    );
  }

  if (!reachSegments) {
    return null;
  }

  return (
    <TrackManager
      reachSegments={reachSegments}
      onBiomeChange={onBiomeChange}
      raftRef={playerRef}
      forecastSamples={forecastSamples}
    />
  );
}
