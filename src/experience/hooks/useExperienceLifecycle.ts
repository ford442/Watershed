import { useEffect, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useCameraShake } from '../../hooks/useCameraShake';
import { useSegmentAudio } from '../../hooks/useSegmentAudio';
import { initAudio, getAudioManager } from '../../systems/AudioSystem';
import {
  tickScoreSystem,
  awardDodgeBonus,
  awardWaterfallBonus,
  awardFloodSurviveBonus,
  resetScoreSystemState,
  cancelLaunch,
} from '../../systems/ScoreSystem';
import { useGameStore, batchFrameUpdate } from '../../systems/GameState';
import { tickGhostRecording } from '../../systems/GhostRecorder';
import { isElevatedRisk } from '../../systems/flowForecast';
import type { DebugStageController } from '../../debug/debugStages';
import type { VehicleRigidBodyRef } from '../types';

interface UseExperienceLifecycleOptions {
  debug: DebugStageController;
  vehicleRef: RefObject<VehicleRigidBodyRef | null>;
  playerVelocityRef: RefObject<number>;
  awardedWaterfallSegmentsRef: RefObject<Set<number>>;
}

export function useExperienceLifecycle({
  debug,
  vehicleRef,
  playerVelocityRef,
  awardedWaterfallSegmentsRef,
}: UseExperienceLifecycleOptions) {
  const { camera } = useThree();
  const cameraShake = useCameraShake();

  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const isWipeout = useGameStore((s) => s.isWipeout);
  const setIsWipeout = useGameStore((s) => s.setIsWipeout);
  const setCurrentSegmentIndex = useGameStore((s) => s.setCurrentSegmentIndex);
  const setRespawnSegmentIndex = useGameStore((s) => s.setRespawnSegmentIndex);
  const setWaterfallGravityMultiplier = useGameStore((s) => s.setWaterfallGravityMultiplier);
  const setDistanceTraveled = useGameStore((s) => s.setDistanceTraveled);
  const setSpawnPoint = useGameStore((s) => s.setSpawnPoint);

  const slowFrameCount = useRef(0);
  const warnedSlowFrames = useRef(false);
  const previousRiskRef = useRef<{
    segmentIndex: number;
    state: string;
    surviveBonus: number;
  } | null>(null);

  useSegmentAudio(currentSegmentIndex);

  useEffect(() => {
    if (isWipeout) {
      previousRiskRef.current = null;
    }
  }, [isWipeout]);

  useEffect(() => {
    resetScoreSystemState();
    previousRiskRef.current = null;
  }, []);

  useEffect(() => {
    debug.runStage('audio', () => {
      initAudio(camera);
    });
  }, [camera, debug]);

  useFrame(() => {
    const pos = vehicleRef.current?.translation();
    if (pos && (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z))) {
      console.error('[NaNGuard] vehicle translation non-finite', pos);
    }
    const camPos = camera.position;
    const camFinite = Number.isFinite(camPos?.x) && Number.isFinite(camPos?.y) && Number.isFinite(camPos?.z);
    if (!camFinite) {
      console.error('[NaNGuard] camera position non-finite', camPos);
      return;
    }
    if (camera.matrixWorld.elements.some((v) => !Number.isFinite(v))) {
      console.error('[NaNGuard] camera matrixWorld non-finite', camera.matrixWorld.elements);
    }
    if (typeof window !== 'undefined') {
      window.__watershedCameraDiag = {
        uuid: camera.uuid,
        pos: { x: camPos.x, y: camPos.y, z: camPos.z },
        quat: {
          x: camera.quaternion.x,
          y: camera.quaternion.y,
          z: camera.quaternion.z,
          w: camera.quaternion.w,
        },
        matrixWorld: Array.from(camera.matrixWorld.elements),
      };
    }
  });

  useEffect(() => {
    if (!debug.isStageEnabled('stateManagement')) return;
    try {
      debug.setStageLoading('stateManagement');

      const handleSegmentEnter = (e: Event) => {
        const detail = (e as CustomEvent<{
          segmentIndex?: number;
          gravityMultiplier?: number;
          segmentState?: string;
          surviveBonus?: number;
        }>).detail;
        const index = detail?.segmentIndex ?? 0;
        const segmentState = detail?.segmentState ?? 'Normal';
        const surviveBonus = detail?.surviveBonus ?? 0;

        // Award flood-survive bonus when cleanly exiting an elevated-risk segment.
        const previous = previousRiskRef.current;
        if (
          previous &&
          previous.segmentIndex !== index &&
          isElevatedRisk(previous.state) &&
          previous.surviveBonus > 0 &&
          !useGameStore.getState().isWipeout
        ) {
          awardFloodSurviveBonus(previous.surviveBonus);
        }
        previousRiskRef.current = {
          segmentIndex: index,
          state: segmentState,
          surviveBonus,
        };

        setCurrentSegmentIndex(index);
        setRespawnSegmentIndex(index);

        if (detail?.gravityMultiplier !== undefined) {
          setWaterfallGravityMultiplier(detail.gravityMultiplier);
        } else if (index === 14) {
          setWaterfallGravityMultiplier(1.45);
        } else if (index === 15) {
          setWaterfallGravityMultiplier(1.0);
        } else if (index >= 23 && index <= 29) {
          setWaterfallGravityMultiplier(1.2);
        } else if (index === 30) {
          setWaterfallGravityMultiplier(1.0);
        }

        if (
          (index === 15 || index === 30) &&
          !awardedWaterfallSegmentsRef.current?.has(index)
        ) {
          awardedWaterfallSegmentsRef.current?.add(index);
          awardWaterfallBonus();
        }

        const audio = getAudioManager();
        if (audio) {
          if (index >= 23 && index <= 27) {
            audio.setAmbient('ambient_water', 1500);
          } else if (index === 28) {
            audio.playSound('rapids_roar', 0.8);
            audio.playSound('water_crash', 0.3);
          } else if (index === 29) {
            audio.playSound('water_crash', 1.0);
            window.dispatchEvent(new CustomEvent('camera-shake', { detail: { intensity: 0.7 } }));
          } else if (index === 30) {
            audio.setAmbient('ambient_water', 1500);
          }
        }
      };

      const handleSegmentSpawn = (e: Event) => {
        const { segmentIndex, spawnPoint } =
          (e as CustomEvent<{ segmentIndex?: number; spawnPoint?: { x: number; y: number; z: number } }>).detail ??
          {};
        if (segmentIndex !== undefined && spawnPoint) {
          setSpawnPoint(segmentIndex, spawnPoint);
        }
      };

      window.addEventListener('segment-enter', handleSegmentEnter);
      window.addEventListener('segment-spawn', handleSegmentSpawn);
      debug.setStageSuccess('stateManagement');
      return () => {
        window.removeEventListener('segment-enter', handleSegmentEnter);
        window.removeEventListener('segment-spawn', handleSegmentSpawn);
      };
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
      return undefined;
    }
  }, [
    awardedWaterfallSegmentsRef,
    debug,
    setCurrentSegmentIndex,
    setRespawnSegmentIndex,
    setSpawnPoint,
    setWaterfallGravityMultiplier,
  ]);

  useEffect(() => {
    const handleNearMiss = () => {
      const game = useGameStore.getState();
      if (!game.isWipeout) {
        awardDodgeBonus();
      }
    };

    window.addEventListener('player-near-miss', handleNearMiss);
    return () => window.removeEventListener('player-near-miss', handleNearMiss);
  }, []);

  useFrame((_, delta) => {
    if (!debug.isStageEnabled('stateManagement')) return;
    try {
      cameraShake.update(delta);

      if (delta > 0.025) {
        slowFrameCount.current += 1;
        if (slowFrameCount.current > 60 && !warnedSlowFrames.current) {
          warnedSlowFrames.current = true;
          console.warn(
            `[Experience] Sustained slow frames detected: ${Math.round(delta * 1000)}ms ` +
              `(${Math.round(1 / delta)} FPS). Target is <17ms (60 FPS).`,
          );
        }
      } else {
        slowFrameCount.current = Math.max(0, slowFrameCount.current - 1);
      }

      if (vehicleRef.current) {
        const vel = vehicleRef.current.linvel?.();
        const pos = vehicleRef.current.translation?.();

        const velOk = vel && Number.isFinite(vel.x) && Number.isFinite(vel.z);
        const posOk = pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);

        if (velOk) {
          const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
          playerVelocityRef.current = speed;
          tickScoreSystem(delta, speed);

          const downstream = posOk ? Math.abs(pos.z) : 0;
          const meters = Math.floor(downstream * 0.5);
          batchFrameUpdate(
            { x: posOk ? pos.x : 0, y: posOk ? pos.y : 0, z: posOk ? pos.z : 0 },
            speed,
            useGameStore.getState().currentSegmentIndex,
          );
          setDistanceTraveled(meters);

          const game = useGameStore.getState();
          if (!game.isPaused && !game.isWipeout && posOk) {
            let qx = camera.quaternion.x;
            let qy = camera.quaternion.y;
            let qz = camera.quaternion.z;
            let qw = camera.quaternion.w;

            if (game.vehicleType === 'raft' && vehicleRef.current?.rotation) {
              const rot = vehicleRef.current.rotation();
              qx = rot.x;
              qy = rot.y;
              qz = rot.z;
              qw = rot.w;
            }

            tickGhostRecording(delta, {
              px: pos.x,
              py: pos.y,
              pz: pos.z,
              qx,
              qy,
              qz,
              qw,
            });
          }
        }

        if (posOk && pos.y < -80 && !isWipeout) {
          cancelLaunch();
          setIsWipeout(true);
        }
      }
    } catch (error) {
      debug.setStageFailure('stateManagement', error);
    }
  });
}
