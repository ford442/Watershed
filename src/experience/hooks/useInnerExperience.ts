import { useCallback, useEffect, useRef, useState } from 'react';
import { useLOD } from '../../systems/lod/LODManager';
import { useGameStore } from '../../systems/GameState';
import type { TrackManagerRef } from '../../components/TrackManager';
import type { DebugStageController } from '../../debug/debugStages';
import type { InnerExperienceProps, VehicleRigidBodyRef, VehicleType } from '../types';
import { useExperienceLifecycle } from './useExperienceLifecycle';
import { useExperienceWorld } from './useExperienceWorld';
import { getMapDefinition, isMapRegistryId } from '../../maps/registry';
import { gameEvents } from '../../systems/events/GameEvents';
import { getVehicleChoice, getVehicleOverride, subscribeVehicleChoice } from '../../utils/runContext';
import { queryFlags } from '../../config/queryFlags';

function readVehicleTypeFromUrl(): VehicleType | null {
  const raw = queryFlags().vehicle;
  if (raw === 'raft' || raw === 'runner') return raw;
  return null;
}

export function resolveInitialVehicle(mapId?: string): VehicleType {
  const pinned = getVehicleOverride();
  if (pinned) return pinned;
  const fromUrl = readVehicleTypeFromUrl();
  if (fromUrl) return fromUrl;
  const chosen = getVehicleChoice(mapId);
  if (chosen) return chosen;
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
  const [noPointerLock] = useState(() => queryFlags().noPointerLock);
  // ?wasmWaterTest=1 is a dev harness; production ignores it (#465 C5).
  const [wasmWaterTest] = useState(() => import.meta.env.DEV && queryFlags().wasmWaterTest);

  const vehicleRef = useRef<VehicleRigidBodyRef | null>(null);
  const trackManagerRef = useRef<TrackManagerRef | null>(null);
  const playerVelocityRef = useRef(0);
  const awardedWaterfallSegmentsRef = useRef(new Set<number>());
  const urlVehicleOverrideRef = useRef(readVehicleTypeFromUrl() !== null || getVehicleOverride() !== null);

  const isDebug = queryFlags().debug;
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

  useEffect(() => {
    setVehicleTypeStore(vehicleType);
  }, [setVehicleTypeStore, vehicleType]);

  // Map preferredVehicle when StartMenu / continue changes the active map.
  // URL `?vehicle=` wins for the whole session once present.
  // A StartMenu pick for this map wins over its preference.
  useEffect(() => {
    if (!mapId || urlVehicleOverrideRef.current) return;
    const preferred = getVehicleChoice(mapId) ?? getMapDefinition(mapId).preferredVehicle;
    if (preferred && preferred !== vehicleType) {
      setVehicleType(preferred);
    }
  }, [mapId, setVehicleType, vehicleType]);

  // The pick can land after this mounts (the world mounts behind the menu).
  useEffect(() => {
    if (urlVehicleOverrideRef.current) return;
    // "River decides" after an earlier pick returns to the map's own vehicle.
    return subscribeVehicleChoice(() => {
      const preferred = mapId && isMapRegistryId(mapId) ? getMapDefinition(mapId).preferredVehicle : undefined;
      setVehicleType(getVehicleChoice(mapId) ?? preferred ?? 'runner');
    });
  }, [mapId, setVehicleType]);

  // Segment-authored forceVehicle (delta raft launch, hydro→delta continuation).
  useEffect(() => {
    if (urlVehicleOverrideRef.current) return;

    return gameEvents.on('segment-enter', ({ forceVehicle }) => {
      if (forceVehicle) setVehicleType(forceVehicle);
    });
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
    ...world,
  };
}
