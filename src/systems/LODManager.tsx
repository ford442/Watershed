/**
 * LODManager - Level-of-Detail and performance management system
 * 
 * Handles:
 * - Adaptive quality scaling based on FPS
 * - Distance-based LOD transitions
 * - Frustum culling for particles and objects
 * - Performance monitoring and reporting
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

// Quality levels
type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

interface LODConfig {
  particleDensity: number;
  shadowMapSize: number;
  enableReflections: boolean;
  enableCaustics: boolean;
  enableGodRays: boolean;
  enableMotionBlur: boolean;
  enableBloom: boolean;
  volumetricSamples: number;
  maxParticles: number;
  viewDistance: number;
}

const QUALITY_SETTINGS: Record<QualityLevel, LODConfig> = {
  low: {
    particleDensity: 0.4,
    shadowMapSize: 1024,
    enableReflections: false,
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
    enableReflections: false,
    enableCaustics: true,
    enableGodRays: false,
    enableMotionBlur: false,
    enableBloom: true,
    volumetricSamples: 16,
    maxParticles: 500,
    viewDistance: 150,
  },
  high: {
    particleDensity: 1.0,
    shadowMapSize: 2048,
    enableReflections: true,
    enableCaustics: true,
    enableGodRays: true,
    enableMotionBlur: true,
    enableBloom: true,
    volumetricSamples: 32,
    maxParticles: 1000,
    viewDistance: 200,
  },
  ultra: {
    particleDensity: 1.5,
    shadowMapSize: 4096,
    enableReflections: true,
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
  const [quality, setQuality] = useState<QualityLevel>(initialQuality);
  const [fps, setFps] = useState(60);
  const [enableAdaptive, setEnableAdaptive] = useState(initialAdaptive);
  
  const config = QUALITY_SETTINGS[quality];
  
  // Adaptive quality based on FPS
  const fpsHistory = useRef<number[]>([]);
  const lastAdjustment = useRef(0);
  
  useFrame(() => {
    if (!enableAdaptive) return;
    
    // Calculate FPS
    const now = performance.now();
    const delta = now - lastAdjustment.current;
    
    if (delta > 500) { // Check every 500ms
      const currentFPS = 1000 / (delta / 60); // Approximate
      fpsHistory.current.push(currentFPS);
      
      if (fpsHistory.current.length > 10) {
        fpsHistory.current.shift();
        
        const avgFPS = fpsHistory.current.reduce((a, b) => a + b) / fpsHistory.current.length;
        setFps(Math.round(avgFPS));
        
        // Adjust quality
        const qualities: QualityLevel[] = ['low', 'medium', 'high', 'ultra'];
        const currentIndex = qualities.indexOf(quality);
        
        if (avgFPS < targetFPS - 10 && currentIndex > 0) {
          setQuality(qualities[currentIndex - 1]);
        } else if (avgFPS > targetFPS + 15 && currentIndex < qualities.length - 1) {
          setQuality(qualities[currentIndex + 1]);
        }
      }
      
      lastAdjustment.current = now;
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
  visible = process.env.NODE_ENV === 'development',
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
    }}>
      <div>FPS: {fps}</div>
      <div>Quality: {quality}</div>
      <div>Particles: {config.maxParticles}</div>
      <div>Reflections: {config.enableReflections ? 'ON' : 'OFF'}</div>
      <div>God Rays: {config.enableGodRays ? 'ON' : 'OFF'}</div>
      <div>Memory: {memory}MB</div>
    </div>
  );
};

export default LODManager;
