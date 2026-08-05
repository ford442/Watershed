/**
 * WaterReflection - Planar reflection system for water surface
 *
 * Renders scene from flipped camera position into a WebGLRenderTarget and
 * publishes the texture via waterReflectionStore for FlowingWater to sample.
 */

import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useWaterReflectionStore } from '../systems/waterReflectionStore';

export interface WaterReflectionProps {
  waterLevel?: number;
  resolution?: number;
  /** Update every N frames */
  updateInterval?: number;
  reflectionStrength?: number;
}

/**
 * WaterReflection component - Manages reflection rendering
 */
export default function WaterReflection({
  waterLevel = 0.5,
  resolution = 1024,
  updateInterval = 2,
  reflectionStrength = 0.6,
}: WaterReflectionProps) {
  const { scene, camera, gl } = useThree();
  const reflectionCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const renderTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const frameCount = useRef(0);
  const hiddenWaterRef = useRef<THREE.Mesh[]>([]);

  // Create reflection camera and render target; publish texture to store
  useEffect(() => {
    const rt = new THREE.WebGLRenderTarget(resolution, resolution, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
    renderTargetRef.current = rt;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    reflectionCameraRef.current = new THREE.PerspectiveCamera(
      perspectiveCamera.fov,
      perspectiveCamera.aspect,
      perspectiveCamera.near,
      perspectiveCamera.far,
    );

    const store = useWaterReflectionStore.getState();
    store.setTexture(rt.texture);
    store.setStrength(reflectionStrength);

    return () => {
      useWaterReflectionStore.getState().clear();
      rt.dispose();
      renderTargetRef.current = null;
    };
  }, [resolution, camera, reflectionStrength]);

  // Keep strength in sync when LOD / prop changes without recreating the RT
  useEffect(() => {
    useWaterReflectionStore.getState().setStrength(reflectionStrength);
  }, [reflectionStrength]);

  // Update reflection
  useFrame(() => {
    frameCount.current++;

    // Skip frames for performance
    if (frameCount.current % updateInterval !== 0) return;

    const reflectCam = reflectionCameraRef.current;
    const renderTarget = renderTargetRef.current;

    if (!reflectCam || !renderTarget) return;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;

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
      camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10),
    );
    lookAtPos.y = waterLevel - (lookAtPos.y - waterLevel);
    reflectCam.lookAt(lookAtPos);

    // Update projection
    reflectCam.projectionMatrix.copy(perspectiveCamera.projectionMatrix);

    // Snapshot GL state
    const currentRenderTarget = gl.getRenderTarget();
    const currentAutoClear = gl.autoClear;
    const currentScissorTest = gl.getScissorTest();
    const currentViewport = gl.getViewport(new THREE.Vector4());
    const currentScissor = gl.getScissor(new THREE.Vector4());

    // Hide water surfaces to avoid feedback loop
    const hidden = hiddenWaterRef.current;
    hidden.length = 0;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.userData?.isWaterSurface && mesh.visible) {
        hidden.push(mesh);
        mesh.visible = false;
      }
    });

    // Clip plane to only render above water
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -waterLevel);
    gl.clippingPlanes = [clipPlane];

    // Render
    gl.autoClear = true;
    gl.setRenderTarget(renderTarget);
    gl.clear();
    gl.render(scene, reflectCam);

    // Restore water visibility
    for (let i = 0; i < hidden.length; i++) {
      hidden[i].visible = true;
    }
    hidden.length = 0;

    // Restore GL state
    gl.setRenderTarget(currentRenderTarget);
    gl.autoClear = currentAutoClear;
    gl.setViewport(currentViewport.x, currentViewport.y, currentViewport.z, currentViewport.w);
    gl.setScissor(currentScissor.x, currentScissor.y, currentScissor.z, currentScissor.w);
    gl.setScissorTest(currentScissorTest);

    // Clear clip planes
    gl.clippingPlanes = [];
  });

  return null;
}

/**
 * Hook to get the current planar reflection texture (or null when pass is unmounted).
 */
export function useWaterReflection() {
  return useWaterReflectionStore((s) => s.texture);
}
