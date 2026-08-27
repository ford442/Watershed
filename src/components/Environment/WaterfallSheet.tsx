import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { WaterfallSheetProps } from './types';
import { resolveMaterialBackend } from '../../rendering/materialBackend';
import { createWaterfallSheetMaterial } from '../../materials/vfx/createVfxMaterials';
import { materialUniformBag } from '../../materials/dual/materialUniformBag';

export default function WaterfallSheet({
  width = 10,
  height = 20,
  flowSpeed = 1.2,
  fanAngle = 0,
}: WaterfallSheetProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const overlayRef = useRef<THREE.Mesh>(null);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(width, height, 28, 36);
    const positions = geo.attributes.position;
    const curtainDepth = new Float32Array(positions.count);
    const billow = Math.tan((fanAngle * Math.PI) / 180) * 0.08;

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      const xNorm = width > 0 ? x / (width * 0.5) : 0;
      const yNorm = height > 0 ? (y + height * 0.5) / height : 0;
      const swell = Math.sin(yNorm * Math.PI * 2.1 + xNorm * 1.9) * 0.18;
      const depth = swell + xNorm * billow;
      positions.setZ(i, depth);
      curtainDepth[i] = yNorm;
    }

    geo.setAttribute('curtainDepth', new THREE.BufferAttribute(curtainDepth, 1));
    positions.needsUpdate = true;
    geo.computeVertexNormals();
    return geo;
  }, [width, height, fanAngle]);

  const sheetColors = useMemo(
    () => ({
      waterColor: new THREE.Color('#8fd8ff'),
      deepColor: new THREE.Color('#dff7ff'),
      foamColor: new THREE.Color('#ffffff'),
    }),
    [],
  );

  const makeMaterial = (layerSpeed: number, opacity: number, offset: number) =>
    createWaterfallSheetMaterial(resolveMaterialBackend().backend, {
      flowSpeed: flowSpeed * layerSpeed,
      baseOpacity: opacity,
      layerOffset: offset,
      ...sheetColors,
    });

  const coreMaterial = useMemo(() => makeMaterial(1.0, 0.72, 0.0), [flowSpeed, sheetColors]);
  const overlayMaterial = useMemo(() => makeMaterial(1.45, 0.34, 1.7), [flowSpeed, sheetColors]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const coreU = materialUniformBag(coreRef.current?.material as THREE.Material | undefined);
    if (coreU?.time) coreU.time.value = t;
    const overlayU = materialUniformBag(overlayRef.current?.material as THREE.Material | undefined);
    if (overlayU?.time) overlayU.time.value = t;
  });

  return (
    <group position={[0, -height * 0.5 + 0.4, -0.4]}>
      <mesh ref={coreRef} geometry={geometry} material={coreMaterial} frustumCulled={false} />
      <mesh ref={overlayRef} geometry={geometry} material={overlayMaterial} position={[0, 0, -0.18]} frustumCulled={false} />
    </group>
  );
}
