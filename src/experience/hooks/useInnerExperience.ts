import { useCallback, useEffect, useRef, useState } from 'react';
import { useBiomeMaterials } from '../../systems/BiomeSystem';
import { useLOD } from '../../systems/LODManager';
import { useGameStore } from '../../systems/GameState';
import type { TrackManagerRef } from '../../components/TrackManager';
import type { DebugStageController } from '../../debug/debugStages';
import type { InnerExperienceProps, VehicleRigidBodyRef, VehicleType } from '../types';
import { useExperienceLifecycle } from './useExperienceLifecycle';
import { useExperienceWorld } from './useExperienceWorld';

function readVehicleTypeFromUrl(): VehicleType {
  if (typeof window === 'undefined') return 'runner';
  return new URLSearchParams(window.location.search).get('vehicle') === 'raft' ? 'raft' : 'runner';
}

export function useInnerExperience({
  debug,
  physicsDebug = false,
  cleanTest = false,
}: Pick<InnerExperienceProps, 'physicsDebug' | 'cleanTest'> & { debug: DebugStageController }) {
  const [vehicleType, setVehicleTypeLocal] = useState<VehicleType>(readVehicleTypeFromUrl);
  const [noPointerLock] = useState(
    () => typeof window !== 'undefined' && window.location.search.includes('no-pointer-lock'),
  );
  const [wasmWaterTest] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('wasmWaterTest') === '1',
  );

  const vehicleRef = useRef<VehicleRigidBodyRef | null>(null);
  const trackManagerRef = useRef<TrackManagerRef | null>(null);
  const playerVelocityRef = useRef(0);
  const awardedWaterfallSegmentsRef = useRef(new Set<number>());

  const isDebug = typeof window !== 'undefined' && window.location.search.includes('debug=true');
  const physicsDebugEnabled =
    !cleanTest && debug.debugEnabled && physicsDebug && debug.isStageEnabled('physicsDebug');

  const biome = useGameStore((s) => s.currentBiome);
  const currentSegmentIndex = useGameStore((s) => s.currentSegmentIndex);
  const isWipeout = useGameStore((s) => s.isWipeout);
  const isJourneyComplete = useGameStore((s) => s.isJourneyComplete);
  const setVehicleTypeStore = useGameStore((s) => s.setVehicleType);

  const setVehicleType = useCallback(
    (type: VehicleType) => {
      setVehicleTypeLocal(type);
      setVehicleTypeStore(type);
    },
    [setVehicleTypeStore],
  );

  const { quality } = useLOD();
  const biomeMaterials = useBiomeMaterials();

  useEffect(() => {
    setVehicleTypeStore(vehicleType);
  }, [setVehicleTypeStore, vehicleType]);

  useExperienceLifecycle({
    debug,
    vehicleRef,
    playerVelocityRef,
    awardedWaterfallSegmentsRef,
  });

  const world = useExperienceWorld({
    debug,
    vehicleRef,
    trackManagerRef,
    awardedWaterfallSegmentsRef,
  });

  return {
    vehicleRef,
    trackManagerRef,
    playerVelocityRef,
    vehicleType,
    setVehicleType,
    noPointerLock,
    wasmWaterTest,
    physicsDebugEnabled,
    isDebug,
    biome,
    currentSegmentIndex,
    isWipeout,
    isJourneyComplete,
    quality,
    biomeMaterials,
    ...world,
  };
}
