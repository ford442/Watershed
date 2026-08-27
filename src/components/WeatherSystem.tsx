/**
 * WeatherSystem.tsx
 *
 * Dynamic weather effects for Watershed:
 * - Rain particles (Points + custom shader)
 * - Water surface splash particles
 * - Dynamic fog density and color
 * - Dynamic lighting adjustments
 * - Weather event dispatch for shaders and gameplay
 */

import { useEffect, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { WATER_LEVEL } from '../constants/game';
import { WEATHER_CONFIG, WeatherType } from '../constants/weather';
import { resolveMaterialBackend } from '../rendering/materialBackend';
import { createWeatherParticleMaterial } from '../materials/weather/createWeatherParticleMaterial';
import { materialUniformBag } from '../materials/dual/materialUniformBag';

interface WeatherSystemProps {
  targetRef: React.RefObject<any>;
  weather?: { type: WeatherType; intensity: number };
}

export default function WeatherSystem({ targetRef, weather }: WeatherSystemProps) {
  const { scene } = useThree();
  const materialBackend = useMemo(() => resolveMaterialBackend().backend, []);
  const currentWeatherRef = useRef<WeatherType>('clear');
  const targetWeatherRef = useRef<WeatherType>(weather?.type || 'clear');
  const intensityRef = useRef(weather?.intensity ?? 0.5);
  const targetIntensityRef = useRef(weather?.intensity ?? 0.5);
  const transitionRef = useRef(0); // 0 = clear, 1 = full weather

  const rainRef = useRef<THREE.Points | null>(null);
  const snowRef = useRef<THREE.Points | null>(null);
  const splashRef = useRef<THREE.Points | null>(null);
  const splashDataRef = useRef({
    spawnTimes: new Float32Array(WEATHER_CONFIG.rain.splashCount),
    origins: new Float32Array(WEATHER_CONFIG.rain.splashCount * 3),
    durations: new Float32Array(WEATHER_CONFIG.rain.splashCount),
    sizes: new Float32Array(WEATHER_CONFIG.rain.splashCount),
    active: new Array(WEATHER_CONFIG.rain.splashCount).fill(false),
    nextIndex: 0,
  });

  // Base lighting values captured on mount
  const baseLightingRef = useRef({
    ambientIntensity: 0.4,
    hemiIntensity: 0.85,
    dirIntensity: 1.4,
    fillIntensity: 0.22,
  });

  // Rain geometry
  const rainGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const count = WEATHER_CONFIG.rain.particleCount;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    const speedVars = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * WEATHER_CONFIG.rain.spawnWidth;
      positions[i * 3 + 1] = Math.random() * WEATHER_CONFIG.rain.spawnHeight;
      positions[i * 3 + 2] = (Math.random() - 0.5) * WEATHER_CONFIG.rain.spawnLength;
      offsets[i] = Math.random() * 100;
      speedVars[i] = 0.8 + Math.random() * 0.4;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('speedVar', new THREE.BufferAttribute(speedVars, 1));
    return geo;
  }, []);

  const rainMaterial = useMemo(
    () =>
      createWeatherParticleMaterial(materialBackend, {
        kind: 'rain',
        fallSpeed: WEATHER_CONFIG.rain.fallSpeed,
        windX: WEATHER_CONFIG.rain.windX,
        windZ: WEATHER_CONFIG.rain.windZ,
      }),
    [materialBackend],
  );

  const snowMaterial = useMemo(
    () =>
      createWeatherParticleMaterial(materialBackend, {
        kind: 'snow',
        fallSpeed: WEATHER_CONFIG.snow.fallSpeed,
        windX: WEATHER_CONFIG.snow.windX,
        windZ: WEATHER_CONFIG.snow.windZ,
      }),
    [materialBackend],
  );

  const snowGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const count = WEATHER_CONFIG.snow.particleCount;
    const positions = new Float32Array(count * 3);
    const offsets = new Float32Array(count);
    const speedVars = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * WEATHER_CONFIG.snow.spawnWidth;
      positions[i * 3 + 1] = Math.random() * WEATHER_CONFIG.snow.spawnHeight;
      positions[i * 3 + 2] = (Math.random() - 0.5) * WEATHER_CONFIG.snow.spawnLength;
      offsets[i] = Math.random() * 100;
      speedVars[i] = 0.6 + Math.random() * 0.8;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    geo.setAttribute('speedVar', new THREE.BufferAttribute(speedVars, 1));
    return geo;
  }, []);
  const splashGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const count = WEATHER_CONFIG.rain.splashCount;
    const positions = new Float32Array(count * 3);
    const spawnTimes = new Float32Array(count);
    const origins = new Float32Array(count * 3);
    const durations = new Float32Array(count);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = WATER_LEVEL;
      positions[i * 3 + 2] = 0;
      spawnTimes[i] = -9999;
      origins[i * 3] = 0;
      origins[i * 3 + 1] = WATER_LEVEL;
      origins[i * 3 + 2] = 0;
      durations[i] = 0.3 + Math.random() * 0.3;
      sizes[i] = 1.5 + Math.random() * 2.5;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('spawnTime', new THREE.BufferAttribute(spawnTimes, 1));
    geo.setAttribute('origin', new THREE.BufferAttribute(origins, 3));
    geo.setAttribute('duration', new THREE.BufferAttribute(durations, 1));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, []);

  const splashMaterial = useMemo(
    () => createWeatherParticleMaterial(materialBackend, { kind: 'splash' }),
    [materialBackend],
  );

  // Capture base lighting from scene on first render
  useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) {
        baseLightingRef.current.ambientIntensity = obj.intensity;
      } else if (obj instanceof THREE.HemisphereLight) {
        baseLightingRef.current.hemiIntensity = obj.intensity;
      } else if (obj instanceof THREE.DirectionalLight) {
        // First directional = main sun, second = fill
        if (baseLightingRef.current.dirIntensity === 1.4) {
          // already set from default, skip unless we want live capture
        }
      }
    });
  }, [scene]);

  // Update target weather when prop changes
  useEffect(() => {
    if (weather) {
      targetWeatherRef.current = weather.type;
      targetIntensityRef.current = weather.intensity;
    }
  }, [weather]);

  useFrame((state, delta) => {
    const targetType = targetWeatherRef.current;
    const currentType = currentWeatherRef.current;
    const targetInt = targetIntensityRef.current;

    // Smoothly transition weather type and intensity
    const isWeatherActive = targetType === 'rain' || targetType === 'storm' || targetType === 'fog' || targetType === 'snow';
    const targetTransition = isWeatherActive ? targetInt : 0;
    const speed = WEATHER_CONFIG.transitionSpeed * delta;
    transitionRef.current += (targetTransition - transitionRef.current) * speed;
    intensityRef.current += (targetInt - intensityRef.current) * speed;

    const t = THREE.MathUtils.clamp(transitionRef.current, 0, 1);
    const weatherType = t > 0.1 ? targetType : 'clear';
    currentWeatherRef.current = weatherType;

    const playerPos = targetRef.current
      ? targetRef.current.translation
        ? targetRef.current.translation()
        : targetRef.current.position
      : { x: 0, y: 0, z: 0 };

    // ======================================================================
    // 1. Rain particles
    // ======================================================================
    const writeBag = (
      mat: THREE.Material,
      patch: Record<string, number | THREE.Vector3 | { x: number; y: number; z: number }>,
    ) => {
      const u = materialUniformBag(mat);
      if (!u) return;
      for (const [key, val] of Object.entries(patch)) {
        if (!u[key]) continue;
        if (u[key].value instanceof THREE.Vector3 && typeof val === 'object' && val && 'x' in val) {
          u[key].value.set(val.x, val.y, val.z);
        } else {
          u[key].value = val;
        }
      }
    };

    if (rainRef.current) {
      const showRain = (weatherType === 'rain' || weatherType === 'storm') && t > 0.05;
      writeBag(rainMaterial, {
        time: state.clock.elapsedTime,
        cameraPos: playerPos,
        globalAlpha: showRain ? t : 0,
        windX: WEATHER_CONFIG.rain.windX * (weatherType === 'storm' ? 2.2 : 1),
        windZ: WEATHER_CONFIG.rain.windZ * (weatherType === 'storm' ? 1.8 : 1),
      });
      rainRef.current.visible = showRain;
    }

    if (snowRef.current) {
      const showSnow = weatherType === 'snow' && t > 0.05;
      writeBag(snowMaterial, {
        time: state.clock.elapsedTime,
        cameraPos: playerPos,
        globalAlpha: showSnow ? t : 0,
        fallSpeed: WEATHER_CONFIG.snow.fallSpeed,
        windX: WEATHER_CONFIG.snow.windX,
        windZ: WEATHER_CONFIG.snow.windZ,
      });
      snowRef.current.visible = showSnow;
    }

    if (splashRef.current) {
      const showSplash = (weatherType === 'rain' || weatherType === 'storm') && t > 0.05;
      writeBag(splashMaterial, {
        time: state.clock.elapsedTime,
        globalAlpha: showSplash
          ? t * WEATHER_CONFIG.rain.splashBrightness * (weatherType === 'storm' ? 1.4 : 1)
          : 0,
      });
      splashRef.current.visible = showSplash;

      if (showSplash) {
        // Spawn new splashes around player
        const spawnRate = Math.floor(
          (weatherType === 'storm' ? 18 : 8) * t * intensityRef.current
        );
        const data = splashDataRef.current;
        const spawnTimesAttr = splashGeometry.attributes.spawnTime as THREE.BufferAttribute;
        const originsAttr = splashGeometry.attributes.origin as THREE.BufferAttribute;
        const positionsAttr = splashGeometry.attributes.position as THREE.BufferAttribute;

        for (let s = 0; s < spawnRate; s++) {
          const idx = data.nextIndex;
          data.nextIndex = (idx + 1) % WEATHER_CONFIG.rain.splashCount;

          const sx = playerPos.x + (Math.random() - 0.5) * WEATHER_CONFIG.rain.spawnWidth * 0.8;
          const sz = playerPos.z + (Math.random() - 0.5) * WEATHER_CONFIG.rain.spawnLength * 0.8;
          const sy = WATER_LEVEL;

          data.spawnTimes[idx] = state.clock.elapsedTime;
          data.origins[idx * 3] = sx;
          data.origins[idx * 3 + 1] = sy;
          data.origins[idx * 3 + 2] = sz;
          data.active[idx] = true;

          spawnTimesAttr.setX(idx, state.clock.elapsedTime);
          originsAttr.setXYZ(idx, sx, sy, sz);
          positionsAttr.setXYZ(idx, sx, sy, sz);
        }

        spawnTimesAttr.needsUpdate = true;
        originsAttr.needsUpdate = true;
        positionsAttr.needsUpdate = true;
      }
    }

    // ======================================================================
    // 3. Fog modulation
    // ======================================================================
    const cfg = WEATHER_CONFIG.fog;
    let targetFogDensity: number = cfg.clearDensity;
    let targetFogColor = new THREE.Color(cfg.clearColor);

    switch (weatherType) {
      case 'rain':
        targetFogDensity = cfg.rainDensity;
        targetFogColor.set(cfg.rainColor);
        break;
      case 'fog':
        targetFogDensity = cfg.fogDensity;
        targetFogColor.set(cfg.fogColor);
        break;
      case 'storm':
        targetFogDensity = cfg.stormDensity;
        targetFogColor.set(cfg.stormColor);
        break;
      case 'snow':
        targetFogDensity = cfg.snowDensity;
        targetFogColor.set(cfg.snowColor);
        break;
      default:
        targetFogDensity = cfg.clearDensity;
        targetFogColor.set(cfg.clearColor);
    }

    const hasFog = scene.fog instanceof THREE.FogExp2;
    if (hasFog) {
      const fog = scene.fog as THREE.FogExp2;
      const currentDensity = fog.density;
      const currentColor = fog.color.clone();
      const newDensity = currentDensity + (targetFogDensity - currentDensity) * speed;
      const newColor = currentColor.lerp(targetFogColor, speed);
      scene.fog = new THREE.FogExp2(newColor, newDensity);
      scene.background = newColor;
    } else if (scene.fog instanceof THREE.Fog) {
      // If linear fog, approximate by increasing far distance
      const fog = scene.fog as THREE.Fog;
      const targetFar = weatherType === 'clear' ? 150 : weatherType === 'fog' ? 60 : 45;
      fog.far += (targetFar - fog.far) * speed;
      fog.color.lerp(targetFogColor, speed);
      scene.background = fog.color.clone();
    }

    // ======================================================================
    // 4. Lighting modulation
    // ======================================================================
    let lightMult = 1.0;
    switch (weatherType) {
      case 'rain':
        lightMult = WEATHER_CONFIG.lighting.rainDirIntensity;
        break;
      case 'fog':
        lightMult = WEATHER_CONFIG.lighting.fogDirIntensity;
        break;
      case 'storm':
        lightMult = WEATHER_CONFIG.lighting.stormDirIntensity;
        break;
      default:
        lightMult = WEATHER_CONFIG.lighting.clearDirIntensity;
    }
    const ambientMult =
      weatherType === 'rain'
        ? WEATHER_CONFIG.lighting.rainAmbientIntensity
        : weatherType === 'fog'
        ? WEATHER_CONFIG.lighting.fogAmbientIntensity
        : weatherType === 'storm'
        ? WEATHER_CONFIG.lighting.stormAmbientIntensity
        : WEATHER_CONFIG.lighting.clearAmbientIntensity;

    scene.traverse((obj) => {
      if (obj instanceof THREE.AmbientLight) {
        obj.intensity += (baseLightingRef.current.ambientIntensity * ambientMult - obj.intensity) * speed;
      } else if (obj instanceof THREE.HemisphereLight) {
        obj.intensity += (baseLightingRef.current.hemiIntensity * ambientMult - obj.intensity) * speed;
      } else if (obj instanceof THREE.DirectionalLight) {
        obj.intensity += (baseLightingRef.current.dirIntensity * lightMult - obj.intensity) * speed;
      }
    });

    // ======================================================================
    // 5. Dispatch weather event for shaders / gameplay
    // ======================================================================
    if (state.clock.elapsedTime % 0.1 < delta) {
      window.dispatchEvent(
        new CustomEvent('weather-update', {
          detail: {
            type: weatherType,
            intensity: intensityRef.current,
            transition: t,
            rippleStrength:
              weatherType === 'storm'
                ? WEATHER_CONFIG.water.stormRippleStrength
                : weatherType === 'rain'
                ? WEATHER_CONFIG.water.rainRippleStrength
                : 0,
            flowSpeedMultiplier:
              weatherType === 'storm'
                ? WEATHER_CONFIG.water.stormFlowSpeedMultiplier
                : weatherType === 'rain'
                ? WEATHER_CONFIG.water.rainFlowSpeedMultiplier
                : 1.0,
            dragBoost:
              weatherType === 'storm'
                ? WEATHER_CONFIG.gameplay.stormDragBoost
                : weatherType === 'rain'
                ? WEATHER_CONFIG.gameplay.rainDragBoost
                : 0,
            boostMultiplier:
              weatherType === 'storm'
                ? WEATHER_CONFIG.gameplay.stormBoostMultiplier
                : weatherType === 'rain'
                ? WEATHER_CONFIG.gameplay.rainBoostMultiplier
                : 1.0,
          },
        })
      );
    }
  });

  return (
    <>
      <points ref={rainRef} geometry={rainGeometry} material={rainMaterial} frustumCulled={false} />
      <points ref={snowRef} geometry={snowGeometry} material={snowMaterial} frustumCulled={false} />
      <points ref={splashRef} geometry={splashGeometry} material={splashMaterial} frustumCulled={false} />
    </>
  );
}
