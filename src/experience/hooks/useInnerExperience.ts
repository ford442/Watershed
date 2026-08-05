import { useCallback, useEffect, useRef, useState } from 'react';
import { useBiomeMaterials } from '../../systems/BiomeSystem';
import { useLOD } from '../../systems/LODManager';
import { useGameStore } from '../../systems/GameState';
import type { TrackManagerRef } from '../../components/TrackManager';
import type { DebugStageController } from '../../debug/debugStages';
import type { InnerExperienceProps, VehicleRigidBodyRef, VehicleType } from '../types';
import { useExperienceLifecycle } from './useExperienceLifecycle';
import { useExperienceWorld } from './useExperienceWorld';
import { getMapDefinition, isMapRegistryId } from '../../maps/registry';

function readVehicleTypeFromUrl(): VehicleType | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('vehicle');
  if (raw === 'raft' || raw === 'runner') return raw;
  return null;
}

function resolveInitialVehicle(mapId?: string): VehicleType {
  const fromUrl = readVehicleTypeFromUrl();
  if (fromUrl) return fromUrl;
  if (mapId && isMapRegistryId(mapId)) {
    const preferred = getMapDefinition(mapId).preferredVehicle;
    if (preferred) return preferred;
  }
  return 'runner';
}

export function useInnerExperience({
  debug,
  physicsDebug = false,
  cleanTest = false,
  mapId,
  onMapChange,
  onReturnToMenu,
  launchHour,
}: Pick<
  InnerExperienceProps,
  'physicsDebug' | 'cleanTest' | 'mapId' | 'onMapChange' | 'onReturnToMenu' | 'launchHour'
> & {
  debug: DebugStageController;
}) {
  const [vehicleType, setVehicleTypeLocal] = useState<VehicleType>(() => resolveInitialVehicle(mapId));
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
  const urlVehicleOverrideRef = useRef(readVehicleTypeFromUrl() !== null);

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

  // Map preferredVehicle when StartMenu / continue changes the active map.
  // URL `?vehicle=` wins for the whole session once present.
  useEffect(() => {
    if (!mapId || urlVehicleOverrideRef.current) return;
    const preferred = getMapDefinition(mapId).preferredVehicle;
    if (preferred && preferred !== vehicleType) {
      setVehicleType(preferred);
    }
  }, [mapId, setVehicleType, vehicleType]);

  // Segment-authored forceVehicle (delta raft launch, hydro→delta continuation).
  useEffect(() => {
    if (typeof window === 'undefined' || urlVehicleOverrideRef.current) return;

    const onSegmentEnter = (event: Event) => {
      const detail = (event as CustomEvent<{ forceVehicle?: VehicleType | null }>).detail;
      const next = detail?.forceVehicle;
      if (next === 'raft' || next === 'runner') {
        setVehicleType(next);
      }
    };

    window.addEventListener('segment-enter', onSegmentEnter);
    return () => window.removeEventListener('segment-enter', onSegmentEnter);
  }, [setVehicleType]);

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
    mapId,
    onMapChange,
    onReturnToMenu,
    launchHour,
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
