import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useLOD } from '../systems/LODManager';
import { useSunPosition } from '../systems/SunPositionSystem';
import { BIOME_LIGHTING } from './constants';

interface SceneLightingProps {
  biome: string;
  currentSegmentIndex: number;
  playerVelocityRef: RefObject<number>;
  enabled: boolean;
}

function waterfallRumbleIntensity(segmentIndex: number, speed: number): number {
  switch (segmentIndex) {
    case 13:
      return 0.05 + Math.min(0.08, speed * 0.002);
    case 14:
      return 0.16 + Math.min(0.16, speed * 0.004);
    case 15:
      return 0.06;
    case 28:
      return 0.08 + Math.min(0.1, speed * 0.003);
    case 29:
      return 0.18 + Math.min(0.18, speed * 0.004);
    case 30:
      return 0.06;
    default:
      return 0;
  }
}

export default function SceneLighting({
  biome,
  currentSegmentIndex,
  playerVelocityRef,
  enabled,
}: SceneLightingProps) {
  const { config: lodConfig } = useLOD();
  const { sunWorldPosition } = useSunPosition();

  const L = BIOME_LIGHTING[biome] ?? BIOME_LIGHTING.canyonSummer;
  const isTightCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
  const isSlotCanyonLighting = biome === 'slotCanyon' || isTightCanyon;
  const ambientIntensity = isSlotCanyonLighting ? Math.min(L.ambientIntensity, 0.18) : L.ambientIntensity;
  const hemiIntensity = isSlotCanyonLighting ? Math.min(L.hemiIntensity, 0.25) : L.hemiIntensity;
  const hemiSkyColor = isSlotCanyonLighting ? '#1a120a' : L.hemiSky;
  const hemiGroundColor = isSlotCanyonLighting ? '#0a0806' : L.hemiGround;

  const sharedSunPosition = useMemo(
    () => [sunWorldPosition.x, sunWorldPosition.y, sunWorldPosition.z] as [number, number, number],
    [sunWorldPosition.x, sunWorldPosition.y, sunWorldPosition.z],
  );

  const lastWaterfallRumbleRef = useRef(-1);
  useFrame(() => {
    const speed = playerVelocityRef.current ?? 0;
    const rumble = waterfallRumbleIntensity(currentSegmentIndex, speed);

    if (Math.abs(rumble - lastWaterfallRumbleRef.current) > 0.01) {
      lastWaterfallRumbleRef.current = rumble;
      window.dispatchEvent(new CustomEvent('camera-rumble', { detail: { intensity: rumble } }));
    }
  });

  const entrySpeedRef = useRef(0);
  useEffect(() => {
    entrySpeedRef.current = playerVelocityRef.current ?? 0;
  }, [currentSegmentIndex, playerVelocityRef]);

  useEffect(() => {
    const speed = entrySpeedRef.current;
    if (currentSegmentIndex === 13) {
      window.dispatchEvent(
        new CustomEvent('camera-shake', {
          detail: { intensity: 0.22, duration: 2.2, frequency: 14, angular: 0.012 },
        }),
      );
    } else if (currentSegmentIndex === 14) {
      const speedBonus = Math.min(0.45, speed * 0.022);
      window.dispatchEvent(
        new CustomEvent('camera-shake', {
          detail: { intensity: 0.75 + speedBonus, duration: 2.8, frequency: 8, angular: 0.04 },
        }),
      );
      window.dispatchEvent(new CustomEvent('boost-triggered', { detail: { intensity: 1.1, duration: 1.0 } }));
    } else if (currentSegmentIndex === 15) {
      window.dispatchEvent(
        new CustomEvent('camera-shake', {
          detail: { intensity: 0.28, duration: 1.4, frequency: 16, angular: 0.008 },
        }),
      );
    } else if (currentSegmentIndex === 29) {
      const speedBonus = Math.min(0.5, speed * 0.025);
      window.dispatchEvent(
        new CustomEvent('camera-shake', {
          detail: { intensity: 0.8 + speedBonus, duration: 3.0, frequency: 8, angular: 0.045 },
        }),
      );
      window.dispatchEvent(new CustomEvent('boost-triggered', { detail: { intensity: 1.2, duration: 1.2 } }));
    }
  }, [currentSegmentIndex]);

  if (!enabled) return null;

  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight color={hemiSkyColor} groundColor={hemiGroundColor} intensity={hemiIntensity} />
      <directionalLight
        color={L.dirColor}
        position={sharedSunPosition}
        intensity={L.dirIntensity}
        castShadow
        shadow-mapSize={[lodConfig.shadowMapSize, lodConfig.shadowMapSize]}
        shadow-bias={lodConfig.shadowBias}
        shadow-normalBias={lodConfig.shadowNormalBias}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
      <directionalLight color={L.fillColor} position={[-10, 15, -20]} intensity={L.fillIntensity} />
    </>
  );
}

export function waterfallFxIntensityForSegment(segmentIndex: number): number {
  switch (segmentIndex) {
    case 13:
      return 0.45;
    case 14:
      return 1.0;
    case 15:
      return 0.55;
    case 28:
      return 0.6;
    case 29:
      return 1.0;
    case 30:
      return 0.45;
    default:
      return 0;
  }
}

export function isTightCanyonSegment(segmentIndex: number): boolean {
  return segmentIndex >= 20 && segmentIndex <= 22;
}
