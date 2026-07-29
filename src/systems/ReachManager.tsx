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
import ReactiveAudio from '../components/ReactiveAudio';
import WeatherSystem from '../components/WeatherSystem';
import { ReachStreamer, ReachManifest } from './ReachStreamer';
import { normalizeReachManifest, NormalizedSegment } from './ReachNormalizer';
import { type BiomeId, normalizeBiomeId } from '../configs/biomes';
import { samplesToForecastByIndex } from './flowForecast';
import { FLOW_FORECAST_STATES } from '../constants/game';
// Removed DOM UI imports — overlays are lifted to Experience.jsx

interface ReachManagerProps {
  /** Player / vehicle rigid body ref */
  playerRef: React.RefObject<any>;
  /** Biome change callback */
  onBiomeChange?: (biome: BiomeId) => void;
  /** Forecast samples for water flow override */
  forecastSamples?: Array<{ state: string; [key: string]: unknown }>;
  /** Reach identifier to load */
  reachId?: string;
  /** Called when loading state changes */
  onLoadingChange?: (loading: boolean) => void;
  /** Called when an error occurs or is cleared */
  onError?: (error: string | null) => void;
  /** Increment to trigger a retry */
  retryKey?: number;
}

export default function ReachManager({
  playerRef,
  onBiomeChange,
  forecastSamples = [],
  reachId = undefined,
  onLoadingChange,
  onError,
  retryKey = 0,
}: ReachManagerProps) {
  const [reachSegments, setReachSegments] = useState<NormalizedSegment[] | null>(null);
  const [manifest, setManifest] = useState<ReachManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transitionLoggedRef = useRef(false);

  // Notify parent of loading / error state changes
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  // Load the Reach on mount / reachId change
  useEffect(() => {
    // Skip loading if no reachId provided
    if (!reachId) {
      setLoading(false);
      setError(null);
      setReachSegments(null);
      setManifest(null);
      return;
    }

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

        const forecastByIndex = samplesToForecastByIndex(forecastSamples);
        const segments = normalizeReachManifest(result.manifest, undefined, {
          forecastByIndex,
          forecastState:
            forecastSamples.length > 0
              ? forecastSamples[0].state
              : FLOW_FORECAST_STATES.NORMAL,
        });

        setManifest(result.manifest);
        setReachSegments(segments);
        console.log(`[ReachManager] Reach ${reachId} loaded with ${segments.length} segments.`);

        // Trigger initial biome callback if provided
        if (onBiomeChange && result.manifest.world?.biome?.baseType) {
          onBiomeChange(normalizeBiomeId(result.manifest.world.biome.baseType));
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
    // Forecast samples are applied live via TrackManager.setForecastByIndex;
    // do not re-fetch the reach when only the forecast changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    return null;
  }

  // If the Reach manifest failed to load (e.g. 404), fall back to procedural
  // generation by rendering TrackManager without reachSegments. ChunkManager
  // will use createSegmentData() instead of adaptReachSegment().
  // Do NOT render ReactiveAudio/WeatherSystem on error to avoid hook errors.
  const segmentsForTrack = error ? undefined : reachSegments ?? undefined;
  const fallbackWeather = { type: 'clear' as const, intensity: 0.5 };

  return (
    <>
      <TrackManager
        reachSegments={segmentsForTrack}
        onBiomeChange={onBiomeChange}
        raftRef={playerRef}
        forecastSamples={forecastSamples}
        reachId={reachId}
      />
      {!error && (
        <>
          <ReactiveAudio
            targetRef={playerRef}
            reachId={reachId}
            manifest={manifest ?? undefined}
            reachSegments={reachSegments ?? []}
          />
          <WeatherSystem
            targetRef={playerRef}
            weather={(manifest?.weather ?? fallbackWeather) as { type: import('../constants/weather').WeatherType; intensity: number }}
          />
        </>
      )}
    </>
  );
}
