/**
 * viewportPrimitives.tsx — orbit controls and fat lines for the Workshop
 * viewport, on three's own JSM addons rather than drei's wrappers.
 *
 * Why not drei's `OrbitControls` / `Line`: they import from the `three-stdlib`
 * barrel, which the game's `PointerLockControls` (in vendor-three, on the boot
 * path) also imports. Rollup files every three-stdlib module the bundle uses
 * under that barrel's chunk, so drei's two would have added ~33 kB to
 * vendor-three for a feature most players never open. three/examples/jsm has
 * no such barrel: these land in the Workshop's own lazy chunk. The same trap
 * applies to drei's TransformControls / PivotControls (spline gizmos, phase B).
 */
import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type * as THREE from 'three';

interface OrbitProps {
  enableRotate?: boolean;
  minDistance?: number;
  maxDistance?: number;
}

/** Orbit controls registered as R3F's default controls (`useThree(s => s.controls)`). */
export function WorkshopOrbitControls({ enableRotate = true, minDistance = 0, maxDistance = Infinity }: OrbitProps) {
  const camera = useThree((s) => s.camera);
  const domElement = useThree((s) => s.gl.domElement);
  const set = useThree((s) => s.set);
  const controls = useMemo(() => new OrbitControls(camera, domElement), [camera, domElement]);

  useEffect(() => {
    set({ controls: controls as unknown as THREE.EventDispatcher });
    return () => {
      set({ controls: null });
      controls.dispose();
    };
  }, [controls, set]);

  useEffect(() => {
    controls.enableRotate = enableRotate;
    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;
  }, [controls, enableRotate, minDistance, maxDistance]);

  useFrame(() => controls.update());
  return null;
}

interface LineProps {
  points: ReadonlyArray<THREE.Vector3 | readonly [number, number, number]>;
  color: string;
  /** Width in pixels. */
  lineWidth?: number;
  transparent?: boolean;
  opacity?: number;
}

/** A screen-space-width polyline (three's Line2). */
export function WorkshopLine({ points, color, lineWidth = 1, transparent = false, opacity = 1 }: LineProps) {
  const size = useThree((s) => s.size);
  const geometry = useMemo(() => {
    const g = new LineGeometry();
    const flat: number[] = [];
    for (const p of points) {
      if (Array.isArray(p)) flat.push(p[0], p[1], p[2]);
      else {
        const v = p as THREE.Vector3;
        flat.push(v.x, v.y, v.z);
      }
    }
    if (flat.length >= 6) g.setPositions(flat);
    return g;
  }, [points]);
  const material = useMemo(
    () => new LineMaterial({ color, linewidth: lineWidth, transparent, opacity }),
    [color, lineWidth, transparent, opacity],
  );
  const line = useMemo(() => new Line2(geometry, material), [geometry, material]);

  useEffect(() => {
    material.resolution.set(size.width, size.height);
  }, [material, size.width, size.height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);

  return <primitive object={line} />;
}
