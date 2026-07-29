/**
 * LODManager - Level-of-Detail and performance management system
 * 
 * Handles:
 * - Adaptive quality scaling based on FPS
 * - Distance-based LOD transitions
 * - Frustum culling for particles and objects
 * - Performance monitoring and reporting
 */

import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { useGameStore } from './GameState';

// Quality levels
type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface LODConfig {
  particleDensity: number;
  shadowMapSize: number;
  // Shadow acne/peter-panning bias, tuned per shadow map resolution.
  shadowBias: number;
  shadowNormalBias: number;
  enableReflections: boolean;
  /** Planar reflection RT width/height when enableReflections is true. */
  reflectionResolution: number;
  /** Render reflection every N frames when enableReflections is true. */
  reflectionUpdateInterval: number;
  /** Fresnel mix weight for FlowingWater reflection sampling (0 = off). */
  reflectionStrength: number;
  enableCaustics: boolean;
  enableGodRays: boolean;
  enableMotionBlur: boolean;
  enableBloom: boolean;
  volumetricSamples: number;
  maxParticles: number;
  viewDistance: number;
}

/** Per-quality budgets — exported for wiring guard tests. */
export const QUALITY_SETTINGS: Record<QualityLevel, LODConfig> = {
  low: {
    particleDensity: 0.4,
    shadowMapSize: 1024,
    shadowBias: -0.0015,
    shadowNormalBias: 0.025,
    enableReflections: false,
    reflectionResolution: 256,
    reflectionUpdateInterval: 4,
    reflectionStrength: 0,
    enableCaustics: false,
    enableGodRays: false,
    enableMotionBlur: false,
    enableBloom: false,
    volumetricSamples: 8,
    maxParticles: 200,
    viewDistance: 100,
  },
  medium: {
    particleDensity: 0.7,
    shadowMapSize: 2048,
    shadowBias: -0.0009,
    shadowNormalBias: 0.018,
    enableReflections: false,
    reflectionResolution: 256,
    reflectionUpdateInterval: 4,
    reflectionStrength: 0,
    enableCaustics: true,
    enableGodRays: true,
    enableMotionBlur: false,
    enableBloom: true,
    volumetricSamples: 16,
    maxParticles: 500,
    viewDistance: 150,
  },
  high: {
    particleDensity: 1.0,
    shadowMapSize: 3072,
    shadowBias: -0.0006,
    shadowNormalBias: 0.012,
    enableReflections: true,
    reflectionResolution: 512,
    reflectionUpdateInterval: 3,
    reflectionStrength: 0.45,
    enableCaustics: true,
    enableGodRays: true,
    enableMotionBlur: false,
    enableBloom: true,
    volumetricSamples: 48,
    maxParticles: 700,
    viewDistance: 200,
  },
  ultra: {
    particleDensity: 1.5,
    shadowMapSize: 4096,
    shadowBias: -0.0004,
    shadowNormalBias: 0.008,
    enableReflections: true,
    reflectionResolution: 1024,
    reflectionUpdateInterval: 2,
    reflectionStrength: 0.6,
    enableCaustics: true,
    enableGodRays: true,
    enableMotionBlur: true,
    enableBloom: true,
    volumetricSamples: 64,
    maxParticles: 2000,
    viewDistance: 300,
  },
};

// Context
type LODContextType = {
  quality: QualityLevel;
  config: LODConfig;
  fps: number;
  setQuality: (q: QualityLevel) => void;
  enableAdaptive: boolean;
  setEnableAdaptive: (v: boolean) => void;
};

const LODContext = createContext<LODContextType | null>(null);

export const useLOD = () => {
  const ctx = useContext(LODContext);
  if (!ctx) throw new Error('useLOD must be used within LODProvider');
  return ctx;
};

// Provider
interface LODProviderProps {
  children: React.ReactNode;
  initialQuality?: QualityLevel;
  enableAdaptive?: boolean;
  targetFPS?: number;
}

export const LODProvider: React.FC<LODProviderProps> = ({
  children,
  initialQuality = 'high',
  enableAdaptive: initialAdaptive = true,
  targetFPS = 60,
}) => {
  // Sync with Zustand store so menu settings affect LOD
  const storeQuality = useGameStore((s) => s.settings.quality);
  const storeSetSettings = useGameStore((s) => s.setSettings);

  const [quality, setQualityState] = useState<QualityLevel>(storeQuality || initialQuality);
  const [fps, setFps] = useState(60);
  const [enableAdaptive, setEnableAdaptive] = useState(initialAdaptive);

  const config = QUALITY_SETTINGS[quality];

  // Keep local quality in sync with store
  useEffect(() => {
    if (storeQuality !== quality) {
      setQualityState(storeQuality);
    }
  }, [storeQuality]);

  const setQuality = (q: QualityLevel) => {
    setQualityState(q);
    storeSetSettings({ quality: q });
  };

  // Adaptive quality based on FPS
  const frameTimes = useRef<number[]>([]);
  const lastFrameTime = useRef(performance.now());
  const lowFpsFrames = useRef(0);
  const warnedFps = useRef(false);
  const warnedMemory = useRef(false);
  const consecutiveLowSeconds = useRef(0);
  const consecutiveHighSeconds = useRef(0);

  useFrame(() => {
    const now = performance.now();
    const delta = now - lastFrameTime.current;
    lastFrameTime.current = now;

    // Track frame times for accurate FPS
    frameTimes.current.push(delta);
    if (frameTimes.current.length > 60) {
      frameTimes.current.shift();
    }

    // Check every ~1 second (60 frames)
    if (frameTimes.current.length >= 60) {
      const avgDelta = frameTimes.current.reduce((a, b) => a + b) / frameTimes.current.length;
      const currentFPS = Math.round(1000 / avgDelta);
      setFps(currentFPS);

      // Goal 5: Performance regression warning — sustained <30 FPS
      if (currentFPS < 30) {
        lowFpsFrames.current += 1;
        if (lowFpsFrames.current > 120 && !warnedFps.current) {
          warnedFps.current = true;
          console.warn(
            `[LODManager] Sustained low FPS detected: ${currentFPS}. ` +
            `Consider lowering graphics quality in settings.`
          );
        }
      } else {
        lowFpsFrames.current = 0;
      }

      // Goal 5: Memory warning — JS heap > 300MB (AGENTS.md target)
      const perf = performance as any;
      if (perf.memory && perf.memory.usedJSHeapSize > 300 * 1048576) {
        if (!warnedMemory.current) {
          warnedMemory.current = true;
          const mb = Math.round(perf.memory.usedJSHeapSize / 1048576);
          console.warn(
            `[LODManager] High memory usage: ${mb}MB. ` +
            `Target is <300MB. Consider lowering quality or restarting.`
          );
        }
      }

      // Adaptive quality with sustained-history hysteresis
      if (enableAdaptive) {
        const qualities: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
        const currentIndex = qualities.indexOf(quality);
        const downgradeThreshold = targetFPS - 10;
        const upgradeThreshold = targetFPS + 5;

        if (currentFPS < downgradeThreshold && currentIndex > 0) {
          consecutiveLowSeconds.current += 1;
          consecutiveHighSeconds.current = 0;

          if (consecutiveLowSeconds.current >= 3) {
            const newQ = qualities[currentIndex - 1];
            console.warn(
              `[LODManager] Sustained low FPS detected: ${currentFPS} (threshold ${downgradeThreshold}). ` +
              `Downgrading quality: ${quality} → ${newQ}`
            );
            setQuality(newQ);
            consecutiveLowSeconds.current = 0;
          }
        } else if (currentFPS > upgradeThreshold && currentIndex < qualities.length - 1) {
          consecutiveHighSeconds.current += 1;
          consecutiveLowSeconds.current = 0;

          if (consecutiveHighSeconds.current >= 2) {
            const newQ = qualities[currentIndex + 1];
            console.log(
              `[LODManager] Sustained high FPS detected: ${currentFPS} (threshold ${upgradeThreshold}). ` +
              `Upgrading quality: ${quality} → ${newQ}`
            );
            setQuality(newQ);
            consecutiveHighSeconds.current = 0;
          }
        } else {
          // FPS is in the stable band — decay counters slowly so momentary spikes don't reset history
          consecutiveLowSeconds.current = Math.max(0, consecutiveLowSeconds.current - 1);
          consecutiveHighSeconds.current = Math.max(0, consecutiveHighSeconds.current - 1);
        }
      }

      frameTimes.current = [];
    }
  });

  return (
    <LODContext.Provider value={{
      quality,
      config,
      fps,
      setQuality,
      enableAdaptive,
      setEnableAdaptive,
    }}>
      {children}
    </LODContext.Provider>
  );
};

/**
 * FrustumCulling - Culls objects outside camera view
 */
interface FrustumCullingProps {
  objects: THREE.Object3D[];
  cullDistance?: number;
  onCulledChange?: (count: number) => void;
}

export const FrustumCulling: React.FC<FrustumCullingProps> = ({
  objects,
  cullDistance = 150,
  onCulledChange,
}) => {
  const { camera } = useThree();
  const frustumRef = useRef(new THREE.Frustum());
  const projMatrixRef = useRef(new THREE.Matrix4());
  
  useFrame(() => {
    // Update frustum
    projMatrixRef.current.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    frustumRef.current.setFromProjectionMatrix(projMatrixRef.current);
    
    const cameraPos = camera.position;
    let culledCount = 0;
    
    objects.forEach(obj => {
      if (!obj) return;
      
      // Distance check
      const dist = obj.position.distanceTo(cameraPos);
      if (dist > cullDistance) {
        obj.visible = false;
        culledCount++;
        return;
      }
      
      // Frustum check
      const inFrustum = frustumRef.current.intersectsObject(obj);
      obj.visible = inFrustum;
      
      if (!inFrustum) culledCount++;
    });
    
    onCulledChange?.(culledCount);
  });
  
  return null;
};

/**
 * LODObject - Component that applies LOD based on distance
 */
interface LODObjectProps {
  lod0: React.ReactNode; // Close (< 30m)
  lod1: React.ReactNode; // Medium (30-80m)
  lod2: React.ReactNode; // Far (> 80m)
  position: [number, number, number];
}

export const LODObject: React.FC<LODObjectProps> = ({
  lod0,
  lod1,
  lod2,
  position,
}) => {
  const { camera } = useThree();
  const [level, setLevel] = useState(0);
  
  useFrame(() => {
    const dist = camera.position.distanceTo(new THREE.Vector3(...position));
    
    if (dist < 30) setLevel(0);
    else if (dist < 80) setLevel(1);
    else setLevel(2);
  });
  
  return (
    <group position={position}>
      {level === 0 && lod0}
      {level === 1 && lod1}
      {level === 2 && lod2}
    </group>
  );
};

/**
 * PerformanceMonitor - Displays FPS and stats (debug only)
 */
interface PerformanceMonitorProps {
  visible?: boolean;
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  visible = import.meta.env.DEV,
}) => {
  const { fps, quality, config } = useLOD();
  const [memory, setMemory] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      if (performance && (performance as any).memory) {
        setMemory(Math.round((performance as any).memory.usedJSHeapSize / 1048576));
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  if (!visible) return null;
  
  return (
    <Html fullscreen>
      <div style={{
        position: 'fixed',
        top: 10,
        right: 10,
        background: 'rgba(0,0,0,0.8)',
        color: '#0f0',
        padding: '12px',
        fontFamily: 'monospace',
        fontSize: '12px',
        borderRadius: '4px',
        zIndex: 10000,
        minWidth: '150px',
        pointerEvents: 'none',
      }}>
        <div>FPS: {fps}</div>
        <div>Quality: {quality}</div>
        <div>Particles: {config.maxParticles}</div>
        <div>Reflections: {config.enableReflections ? 'ON' : 'OFF'}</div>
        <div>God Rays: {config.enableGodRays ? 'ON' : 'OFF'}</div>
        <div>Memory: {memory}MB</div>
      </div>
    </Html>
  );
};
