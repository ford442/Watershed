/**
 * WaterReflection - Planar reflection system for water surface
 * 
 * Renders scene from flipped camera position to create realistic
 * water reflections with fade-by-distance.
 */

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * WaterReflection component - Manages reflection rendering
 */
export default function WaterReflection({ 
  waterLevel = 0.5,
  resolution = 1024,
  updateInterval = 2, // Update every N frames
  reflectionStrength = 0.6,
}) {
  const { scene, camera, gl } = useThree();
  const reflectionCameraRef = useRef();
  const renderTargetRef = useRef();
  const frameCount = useRef(0);
  
  // Create reflection camera and render target
  useEffect(() => {
    renderTargetRef.current = new THREE.WebGLRenderTarget(resolution, resolution, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    
    reflectionCameraRef.current = new THREE.PerspectiveCamera(
      camera.fov,
      camera.aspect,
      camera.near,
      camera.far
    );
    
    return () => {
      renderTargetRef.current?.dispose();
    };
  }, [resolution, camera]);
  
  // Update reflection
  useFrame(() => {
    frameCount.current++;
    
    // Skip frames for performance
    if (frameCount.current % updateInterval !== 0) return;
    
    const reflectCam = reflectionCameraRef.current;
    const renderTarget = renderTargetRef.current;
    
    if (!reflectCam || !renderTarget) return;
    
    // Calculate reflected camera position
    const cameraDistance = camera.position.y - waterLevel;
    
    // Position reflection camera below water
    reflectCam.position.copy(camera.position);
    reflectCam.position.y = waterLevel - cameraDistance;
    
    // Flip camera orientation
    reflectCam.up.copy(camera.up);
    reflectCam.up.y *= -1;
    
    // Look at reflected point
    const lookAtPos = camera.position.clone().add(
      camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10)
    );
    lookAtPos.y = waterLevel - (lookAtPos.y - waterLevel);
    reflectCam.lookAt(lookAtPos);
    
    // Update projection
    reflectCam.projectionMatrix.copy(camera.projectionMatrix);
    
    // Clip plane to only render above water
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterLevel);
    gl.clippingPlanes = [clipPlane];
    
    // Render
    const currentRenderTarget = gl.getRenderTarget();
    gl.setRenderTarget(renderTarget);
    gl.render(scene, reflectCam);
    gl.setRenderTarget(currentRenderTarget);
    
    // Clear clip planes
    gl.clippingPlanes = [];
  });
  
  return null;
}

/**
 * Hook to get reflection texture
 */
export function useWaterReflection() {
  // This would be used by water material to access reflection
  return null;
}
