/**
 * WaterReflection - Planar reflection system for water surface
 *
 * Renders the scene from the mirror camera into a render target and publishes
 * the texture via waterReflectionStore for FlowingWater to sample.
 *
 * - The mirror plane is the *local water datum*: the staged sheet under the
 *   camera (`sampleWaterSheetY`), not the fixed `WATER_LEVEL`. The treadmill
 *   descends hundreds of metres, so a plane at Y 0.5 sat far above the river,
 *   clipped the canyon away and put the mirror camera metres too high.
 * - Clipping is the mirror camera's oblique near plane (`planarMirror.ts`), so
 *   it holds on the node renderer too, which has no `clippingPlanes`.
 * - The target has a depth buffer — without one the scene rendered unsorted.
 * - Half the drawing-buffer resolution (capped by the LOD budget), skipped
 *   while no water can be on screen, water left out by layer
 *   (`WATER_SURFACE_LAYER`), and nothing allocated per frame.
 * - Shadow maps are not re-rendered for the mirror view: the frame's one
 *   shadow update belongs to the main scene pass.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useWaterReflectionStore } from '../systems/water/waterReflectionStore';
import { sampleWaterSheetY } from '../systems/water/bathymetrySampler';
import { WATER_LEVEL } from '../constants/game';
import { frustumReachesBelow, updateMirrorCamera } from '../rendering/planarMirror';
import { WATER_SURFACE_LAYER } from '../rendering/renderLayers';
import { renderScaleViewport } from '../rendering/renderScaleViewport';
import { useRenderScale } from '../systems/GameState';

export interface WaterReflectionProps {
  /** Sheet height above the centreline path (the `sampleWaterSheetY` offset). */
  waterLevel?: number;
  /** Long-edge cap in pixels; the target is otherwise half the drawing buffer. */
  resolution?: number;
  /** Update every N frames */
  updateInterval?: number;
  reflectionStrength?: number;
}

/** Fraction of the drawing buffer the reflection renders at. */
export const REFLECTION_RESOLUTION_SCALE = 0.5;

/** Target size for a drawing buffer: half resolution, long edge capped at `cap`. */
export function reflectionTargetSize(
  bufferWidth: number,
  bufferHeight: number,
  cap: number,
  out: THREE.Vector2,
): THREE.Vector2 {
  const longEdge = Math.max(1, bufferWidth, bufferHeight);
  const scale = Math.min(REFLECTION_RESOLUTION_SCALE, cap / longEdge);
  return out.set(Math.max(1, Math.round(bufferWidth * scale)), Math.max(1, Math.round(bufferHeight * scale)));
}

const WATER_LAYER_MASK = 1 << WATER_SURFACE_LAYER;

// Frame scratch, hoisted: the render loop below allocates nothing.
const _bufferSize = new THREE.Vector2();
const _targetSize = new THREE.Vector2();
const _viewport = new THREE.Vector4();
const _scissor = new THREE.Vector4();
const _scaledViewport = new THREE.Vector4();
const _previousTargetViewport = new THREE.Vector4();
const _previousTargetScissor = new THREE.Vector4();
const _cameraWorld = new THREE.Vector3();

/**
 * WaterReflection component - Manages reflection rendering
 */
export default function WaterReflection({
  waterLevel = WATER_LEVEL,
  resolution = 1024,
  updateInterval = 2,
  reflectionStrength = 0.6,
}: WaterReflectionProps) {
  const { scene, camera, gl, size } = useThree();
  const renderScale = useRenderScale();
  const targetResolution = useRef(resolution);
  const mirrorCamera = useMemo(() => new THREE.PerspectiveCamera(), []);
  const renderTargetRef = useRef<THREE.WebGLRenderTarget | null>(null);
  const frameCount = useRef(0);
  /** Last datum seen under the camera — held across a gap between segments. */
  const datumRef = useRef<number | null>(null);
  /** Strength currently published: 0 while the reflection is skipped. */
  const publishedStrength = useRef(0);

  // Create and size the render target at the stable drawing-buffer ceiling.
  useEffect(() => {
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    gl.getDrawingBufferSize(_bufferSize);
    reflectionTargetSize(_bufferSize.x, _bufferSize.y, targetResolution.current, _targetSize);
    rt.setSize(_targetSize.x, _targetSize.y);
    renderTargetRef.current = rt;
    publishedStrength.current = 0;

    const store = useWaterReflectionStore.getState();
    store.setTexture(rt.texture);
    store.setStrength(0);

    return () => {
      useWaterReflectionStore.getState().clear();
      rt.dispose();
      renderTargetRef.current = null;
    };
  }, [gl]);

  // Browser/CSS resizes may change the ceiling-sized target; valve changes do
  // not, because they leave the drawing buffer dimensions fixed.
  useEffect(() => {
    const renderTarget = renderTargetRef.current;
    if (!renderTarget) return;
    gl.getDrawingBufferSize(_bufferSize);
    reflectionTargetSize(_bufferSize.x, _bufferSize.y, targetResolution.current, _targetSize);
    renderTarget.setSize(_targetSize.x, _targetSize.y);
  }, [gl, size.width, size.height]);

  // Keep strength in sync when LOD / prop changes without recreating the RT
  useEffect(() => {
    if (publishedStrength.current === 0) return;
    publishedStrength.current = reflectionStrength;
    useWaterReflectionStore.getState().setStrength(reflectionStrength);
  }, [reflectionStrength]);

  const publishStrength = (strength: number) => {
    if (publishedStrength.current === strength) return;
    publishedStrength.current = strength;
    useWaterReflectionStore.getState().setStrength(strength);
  };

  useFrame(() => {
    frameCount.current++;

    // Skip frames for performance
    if (frameCount.current % updateInterval !== 0) return;

    const renderTarget = renderTargetRef.current;
    if (!renderTarget) return;

    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    perspectiveCamera.updateMatrixWorld();
    _cameraWorld.setFromMatrixPosition(perspectiveCamera.matrixWorld);

    const sheet = sampleWaterSheetY(_cameraWorld.x, _cameraWorld.z, waterLevel);
    if (sheet !== null) datumRef.current = sheet;
    const datum = datumRef.current;

    const active =
      datum !== null &&
      frustumReachesBelow(perspectiveCamera, datum) &&
      updateMirrorCamera(perspectiveCamera, mirrorCamera, datum);
    publishStrength(active ? reflectionStrength : 0);
    if (!active) return;

    // Same layers as the main camera, minus water (no feedback loop).
    mirrorCamera.layers.mask = perspectiveCamera.layers.mask & ~WATER_LAYER_MASK;

    // Snapshot GL state
    const currentRenderTarget = gl.getRenderTarget();
    const currentAutoClear = gl.autoClear;
    const currentScissorTest = gl.getScissorTest();
    gl.getViewport(_viewport);
    gl.getScissor(_scissor);
    _previousTargetViewport.copy(renderTarget.viewport);
    _previousTargetScissor.copy(renderTarget.scissor);
    const previousTargetScissorTest = renderTarget.scissorTest;
    const shadowMap = gl.shadowMap;
    const shadowAutoUpdate = shadowMap.autoUpdate;
    shadowMap.autoUpdate = false;

    // Render
    gl.autoClear = true;
    renderScaleViewport(
      renderTarget.width,
      renderTarget.height,
      renderScale,
      _scaledViewport,
      'render-target-pixels',
    );
    renderTarget.viewport.set(
      _scaledViewport.x,
      _scaledViewport.y,
      _scaledViewport.z,
      _scaledViewport.w,
    );
    renderTarget.scissor.set(
      _scaledViewport.x,
      _scaledViewport.y,
      _scaledViewport.z,
      _scaledViewport.w,
    );
    renderTarget.scissorTest = true;
    gl.setRenderTarget(renderTarget);
    gl.clear();
    gl.render(scene, mirrorCamera);

    // Restore GL state
    shadowMap.autoUpdate = shadowAutoUpdate;
    gl.setRenderTarget(currentRenderTarget);
    renderTarget.viewport.copy(_previousTargetViewport);
    renderTarget.scissor.copy(_previousTargetScissor);
    renderTarget.scissorTest = previousTargetScissorTest;
    gl.autoClear = currentAutoClear;
    gl.setViewport(_viewport.x, _viewport.y, _viewport.z, _viewport.w);
    gl.setScissor(_scissor.x, _scissor.y, _scissor.z, _scissor.w);
    gl.setScissorTest(currentScissorTest);
  });

  return null;
}

/**
 * Hook to get the current planar reflection texture (or null when pass is unmounted).
 */
export function useWaterReflection() {
  return useWaterReflectionStore((s) => s.texture);
}
