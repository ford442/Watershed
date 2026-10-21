import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useLOD } from '../systems/lod/LODManager';
import { useSunPosition } from '../systems/lighting/SunPositionSystem';
import { deriveRendererContextOptions } from '../rendering';
import { BIOME_LIGHTING } from './constants';
import { SceneLightPool } from '../rendering/sceneLightPool';
import { gameEvents } from '../systems/events/GameEvents';

const KEY_LIGHT_USER_DATA = { keyLight: true } as const;
/** Key light's distance from the point it aims at (inside the shadow camera's near/far). */
const KEY_LIGHT_DISTANCE = 100;
/** Half-extent of the key light's shadow camera (m). */
const SHADOW_HALF_EXTENT = 60;
/** The key light never shines from below the horizon: its direction keeps at least this much up. */
const KEY_LIGHT_MIN_UP = 0.08;
const _lightDir = new THREE.Vector3();

/** Snap to the shadow map's texel grid so the frustum moving with the camera does not shimmer. */
function snapToTexel(value: number, texel: number): number {
  return Math.round(value / texel) * texel;
}

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
  const { quality, config: lodConfig } = useLOD();
  const { sunDirection } = useSunPosition();
  // The key light aims at the camera, so its shadow frustum (±60 m) travels with
  // the run instead of staying at the origin; the sky clock's sun sets the angle.
  const keyTarget = useMemo(() => new THREE.Object3D(), []);

  // Prefer the renderer quality contract (DPR-aware ultra map size; shadows off on low).
  const shadowContract = useMemo(
    () =>
      deriveRendererContextOptions(quality, {
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
      }),
    [quality],
  );
  const castShadows = shadowContract.shadowMode !== 'off';
  const shadowMapSize = shadowContract.shadowMapSize ?? lodConfig.shadowMapSize;

  // Quality can now change mid-run without remounting the Canvas, so the sun's
  // shadow map has to be resized in place. `shadow.mapSize` alone is inert once
  // the render target exists — three allocates it on the first shadow pass and
  // never reallocates. Dispose it and let the next pass rebuild at the new size.
  const sunRef = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const sun = sunRef.current;
    if (!sun) return;
    const map = sun.shadow.map;
    if (map && (map.width !== shadowMapSize || map.height !== shadowMapSize)) {
      map.dispose();
      sun.shadow.map = null as unknown as typeof sun.shadow.map;
    }
    sun.shadow.needsUpdate = true;
  }, [shadowMapSize, castShadows]);

  const L = BIOME_LIGHTING[biome] ?? BIOME_LIGHTING.canyonSummer;
  const isTightCanyon = currentSegmentIndex >= 20 && currentSegmentIndex <= 22;
  const isSlotCanyonLighting = biome === 'slotCanyon' || isTightCanyon;
  const ambientIntensity = isSlotCanyonLighting ? Math.min(L.ambientIntensity, 0.18) : L.ambientIntensity;
  const hemiIntensity = isSlotCanyonLighting ? Math.min(L.hemiIntensity, 0.25) : L.hemiIntensity;
  const hemiSkyColor = isSlotCanyonLighting ? '#1a120a' : L.hemiSky;
  const hemiGroundColor = isSlotCanyonLighting ? '#0a0806' : L.hemiGround;

  useFrame(({ camera }) => {
    const sun = sunRef.current;
    if (!sun) return;
    const texel = (2 * SHADOW_HALF_EXTENT) / shadowMapSize;
    keyTarget.position.set(
      snapToTexel(camera.position.x, texel),
      snapToTexel(camera.position.y, texel),
      snapToTexel(camera.position.z, texel),
    );
    keyTarget.updateMatrixWorld();
    _lightDir.copy(sunDirection);
    if (_lightDir.y < KEY_LIGHT_MIN_UP) {
      _lightDir.y = KEY_LIGHT_MIN_UP;
      _lightDir.normalize();
    }
    sun.position.copy(keyTarget.position).addScaledVector(_lightDir, KEY_LIGHT_DISTANCE);
  });

  const lastWaterfallRumbleRef = useRef(-1);
  useFrame(() => {
    const speed = playerVelocityRef.current ?? 0;
    const rumble = waterfallRumbleIntensity(currentSegmentIndex, speed);

    if (Math.abs(rumble - lastWaterfallRumbleRef.current) > 0.01) {
      lastWaterfallRumbleRef.current = rumble;
      gameEvents.emit('camera-rumble', { intensity: rumble });
    }
  });

  const entrySpeedRef = useRef(0);
  useEffect(() => {
    entrySpeedRef.current = playerVelocityRef.current ?? 0;
  }, [currentSegmentIndex, playerVelocityRef]);

  useEffect(() => {
    const speed = entrySpeedRef.current;
    if (currentSegmentIndex === 13) {
      gameEvents.emit('camera-shake', { intensity: 0.22, duration: 2.2, frequency: 14, angular: 0.012 });
    } else if (currentSegmentIndex === 14) {
      const speedBonus = Math.min(0.45, speed * 0.022);
      gameEvents.emit('camera-shake', { intensity: 0.75 + speedBonus, duration: 2.8, frequency: 8, angular: 0.04 });
      gameEvents.emit('boost-triggered', { intensity: 1.1, duration: 1.0 });
    } else if (currentSegmentIndex === 15) {
      gameEvents.emit('camera-shake', { intensity: 0.28, duration: 1.4, frequency: 16, angular: 0.008 });
    } else if (currentSegmentIndex === 29) {
      const speedBonus = Math.min(0.5, speed * 0.025);
      gameEvents.emit('camera-shake', { intensity: 0.8 + speedBonus, duration: 3.0, frequency: 8, angular: 0.045 });
      gameEvents.emit('boost-triggered', { intensity: 1.2, duration: 1.2 });
    }
  }, [currentSegmentIndex]);

  if (!enabled) return null;

  return (
    <>
      <ambientLight intensity={ambientIntensity} />
      <hemisphereLight color={hemiSkyColor} groundColor={hemiGroundColor} intensity={hemiIntensity} />
      <primitive object={keyTarget} />
      <directionalLight
        ref={sunRef}
        // WeatherSystem strobes the key light, and only it, on a lightning strike (#464).
        userData={KEY_LIGHT_USER_DATA}
        color={L.dirColor}
        target={keyTarget}
        position={[12, 35, 18]}
        intensity={L.dirIntensity}
        castShadow={castShadows}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={lodConfig.shadowBias}
        shadow-normalBias={lodConfig.shadowNormalBias}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-camera-left={-SHADOW_HALF_EXTENT}
        shadow-camera-right={SHADOW_HALF_EXTENT}
        shadow-camera-top={SHADOW_HALF_EXTENT}
        shadow-camera-bottom={-SHADOW_HALF_EXTENT}
      />
      <directionalLight color={L.fillColor} position={[-10, 15, -20]} intensity={L.fillIntensity} />
      {/* Segment lights (fireflies, waterfall spray, slot fill) borrow these: a fixed light count, so a mount never recompiles the scene's programs (#487). */}
      <SceneLightPool />
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
