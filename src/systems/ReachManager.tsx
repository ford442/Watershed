/**
 * ReachManager.tsx
 *
 * Orchestrates Reach lifecycle + multi-Reach seamless handoff.
 * - Loads Reach manifest and assets in the background.
 * - Normalizes manifest data into TrackManager-compatible segments.
 * - On transition entry: prefetch next reach, append continuous segments,
 *   cross-fade biome, emit reach-exit / reach-enter (no Canvas remount).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import TrackManager from '../components/TrackManager';
import ReactiveAudio from '../components/ReactiveAudio';
import WeatherSystem from '../components/WeatherSystem';
import { ReachStreamer, ReachManifest } from './ReachStreamer';
import { normalizeReachManifest, NormalizedSegment } from './ReachNormalizer';
import { type BiomeId, normalizeBiomeId } from '../configs/biomes';
import { samplesToForecastByIndex } from './flowForecast';
import { FLOW_FORECAST_STATES } from '../constants/game';
import { joinWaypoints } from './journeyContinuity';
import {
  emitReachEnter,
  emitReachExit,
  emitJourneyHandoff,
  prefetchNextReach,
  resolveNextReachId,
} from './journeyHandoff';
import { saveJourneyCheckpoint } from './runSession';
import { useGameStore } from './GameState';
import { useBiome } from './BiomeSystem';

interface ReachManagerProps {
  /** Player / vehicle rigid body ref */
  playerRef: React.RefObject<any>;
  /** Biome change callback */
  onBiomeChange?: (biome: BiomeId) => void;
  /** Forecast samples for water flow override */
  forecastSamples?: Array<{ state: string; [key: string]: unknown }>;
  /** Reach identifier to load */
  reachId?: string;
  /** Optional next reach override when manifest omits transition.nextReachId */
  nextReachId?: string;
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
  nextReachId: nextReachIdProp,
  onLoadingChange,
  onError,
  retryKey = 0,
}: ReachManagerProps) {
  const [reachSegments, setReachSegments] = useState<NormalizedSegment[] | null>(null);
  const [manifest, setManifest] = useState<ReachManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeReachId, setActiveReachId] = useState<string | undefined>(reachId);
  const transitionHandledRef = useRef(false);
  const handoffInProgressRef = useRef(false);
  const { setBiome } = useBiome();

  // Notify parent of loading / error state changes
  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  useEffect(() => {
    onError?.(error);
  }, [error, onError]);

  // Load the Reach on mount / reachId change (initial load only — handoffs append)
  useEffect(() => {
    if (!reachId) {
      setLoading(false);
      setError(null);
      setReachSegments(null);
      setManifest(null);
      setActiveReachId(undefined);
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setReachSegments(null);
      setManifest(null);
      transitionHandledRef.current = false;
      handoffInProgressRef.current = false;

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
        setActiveReachId(reachId);
        console.log(`[ReachManager] Reach ${reachId} loaded with ${segments.length} segments.`);

        emitReachEnter({
          reachId,
          nextReachId: resolveNextReachId(result.manifest.transition, nextReachIdProp),
          segmentIndex: 0,
          transitionType: result.manifest.transition?.type,
        });

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

  const performReachHandoff = useCallback(
    async (fromReachId: string, currentManifest: ReachManifest, currentSegments: NormalizedSegment[]) => {
      if (handoffInProgressRef.current) return;
      handoffInProgressRef.current = true;

      const nextId = resolveNextReachId(currentManifest.transition, nextReachIdProp);
      const transitionIndex = currentManifest.transition.segmentIndex;

      emitReachExit({
        reachId: fromReachId,
        nextReachId: nextId,
        segmentIndex: transitionIndex,
        transitionType: currentManifest.transition.type,
      });

      saveJourneyCheckpoint({
        segmentIndex: transitionIndex,
        score: useGameStore.getState().score,
      });

      if (!nextId) {
        console.log(
          `[ReachManager] Transition acted (no nextReachId) — boundary checkpoint saved for ${fromReachId}`,
        );
        handoffInProgressRef.current = false;
        return;
      }

      // Prefetch (404 → procedural remains OK)
      const prefetch = await prefetchNextReach(nextId);
      if (!prefetch?.ok) {
        console.warn(
          `[ReachManager] Next reach ${nextId} unavailable; staying on current treadmill after transition act.`,
        );
        handoffInProgressRef.current = false;
        return;
      }

      try {
        const nextManifest = structuredClone(ReachStreamer.getCachedReach(nextId));
        const prevSeg = currentSegments[currentSegments.length - 1];
        const forecastByIndex = samplesToForecastByIndex(forecastSamples);

        // Continuity: join next waypoints onto previous end before normalize.
        const nextWaypoints = (nextManifest.world?.track?.waypoints ?? []) as number[][];
        if (prevSeg?.points?.length && nextWaypoints.length > 0) {
          const joined = joinWaypoints(
            prevSeg.points,
            nextWaypoints.map((p) => ({ x: p[0], y: p[1], z: p[2] })),
          );
          nextManifest.world.track.waypoints = joined.joinedWaypoints.map((v) => [
            v.x,
            v.y,
            v.z,
          ]);
        }

        const nextSegments = normalizeReachManifest(nextManifest, prevSeg, {
          forecastByIndex,
          forecastState:
            forecastSamples.length > 0
              ? forecastSamples[0].state
              : FLOW_FORECAST_STATES.NORMAL,
        });

        // Re-index appended segments so TrackManager IDs stay monotonic.
        const idOffset = currentSegments.length;
        const appended = nextSegments.map((seg) => ({
          ...seg,
          id: seg.id + idOffset,
        }));

        const merged = [...currentSegments, ...appended];
        setReachSegments(merged);
        setManifest(nextManifest);
        setActiveReachId(nextId);
        transitionHandledRef.current = false;

        const nextBiome = normalizeBiomeId(
          nextManifest.world?.biome?.baseType || 'canyonSummer',
        );
        // Cross-fade — no hard snap / Canvas remount
        setBiome(nextBiome, currentManifest.transition.durationSeconds || 2);
        onBiomeChange?.(nextBiome);

        emitJourneyHandoff({
          kind: 'reach',
          fromId: fromReachId,
          toId: nextId,
          segmentIndex: transitionIndex,
          seamless: true,
          biomeKickoff: {
            biomeId: nextBiome,
            durationSeconds: currentManifest.transition.durationSeconds || 2,
            mode: 'crossfade',
          },
        });
        emitReachEnter({
          reachId: nextId,
          nextReachId: resolveNextReachId(nextManifest.transition),
          segmentIndex: idOffset,
          transitionType: nextManifest.transition?.type,
        });

        console.log(
          `[ReachManager] Seamless handoff ${fromReachId} → ${nextId} (+${appended.length} segments)`,
        );
      } catch (err) {
        console.error(`[ReachManager] Handoff to ${nextId} failed:`, err);
      } finally {
        handoffInProgressRef.current = false;
      }
    },
    [forecastSamples, nextReachIdProp, onBiomeChange, setBiome],
  );

  // Watch player position for transition entry — ACT, do not only log.
  useFrame(() => {
    if (!manifest || !reachSegments || reachSegments.length === 0) return;
    if (!playerRef.current || handoffInProgressRef.current) return;

    const playerPos = playerRef.current.translation
      ? playerRef.current.translation()
      : playerRef.current.position;
    if (!playerPos) return;

    const transitionIndex = manifest.transition.segmentIndex;
    const transitionSegment = reachSegments[transitionIndex];
    if (!transitionSegment) return;

    const segPoints = transitionSegment.points;
    const zMin = Math.min(...segPoints.map((p) => p.z));
    const zMax = Math.max(...segPoints.map((p) => p.z));

    const inTransition = playerPos.z <= zMax && playerPos.z >= zMin;

    if (inTransition && !transitionHandledRef.current) {
      transitionHandledRef.current = true;
      const currentId = activeReachId ?? reachId ?? manifest.reachId;
      console.log(
        `[ReachManager] Transition entry acted for Reach ${currentId} (segment ${transitionIndex}, ${manifest.transition.type})`,
      );
      void performReachHandoff(currentId, manifest, reachSegments);
    } else if (!inTransition && transitionHandledRef.current && !handoffInProgressRef.current) {
      // Allow re-entry detection only before handoff completes; after append the
      // transition index still points at the old seam which the player has left.
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
        reachId={activeReachId ?? reachId}
      />
      {!error && (
        <>
          <ReactiveAudio
            targetRef={playerRef}
            reachId={activeReachId ?? reachId}
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
