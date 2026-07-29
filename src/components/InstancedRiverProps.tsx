// src/components/InstancedRiverProps.tsx
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { InstancedMesh, Object3D, Matrix4, Euler, Vector3 } from 'three';
import { useFrame } from '@react-three/fiber';

interface PlacementItem {
  type: string;
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
}

interface InstancedRiverPropsProps {
  /** Flattened placement data with type field */
  placementData: PlacementItem[];
  /** Geometry lookup by type */
  geometries: Record<string, THREE.BufferGeometry>;
  /** Material lookup by type */
  materials?: Record<string, THREE.Material>;
  /** Optional: enable gentle sway animation for vegetation */
  animateSway?: boolean;
  /** Sway speed multiplier */
  swaySpeed?: number;
  /** Types that should sway (e.g., ['reed', 'grass']) */
  swayTypes?: string[];
}

const dummy = new Object3D();

export default function InstancedRiverProps({
  placementData,
  geometries,
  materials = {},
  animateSway = true,
  swaySpeed = 0.5,
  swayTypes = ['grass', 'reed', 'fern'],
}: InstancedRiverPropsProps) {
  const meshRefs = useRef<Record<string, InstancedMesh>>({});
  
  // Group placement data by type
  const groupedData = useMemo(() => {
    const groups: Record<string, PlacementItem[]> = {};
    placementData.forEach(item => {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    });
    return groups;
  }, [placementData]);

  // Get types that have geometry
  const validTypes = useMemo(() => {
    return Object.keys(groupedData).filter(type => geometries[type]);
  }, [groupedData, geometries]);

  useFrame((state) => {
    if (!animateSway) return;
    
    const time = state.clock.elapsedTime;

    validTypes.forEach(type => {
      const mesh = meshRefs.current[type];
      if (!mesh) return;

      const items = groupedData[type];
      const shouldSway = swayTypes.includes(type);

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        dummy.position.copy(item.position);
        
        if (shouldSway) {
          // Gentle sway for vegetation
          const swayAmount = Math.sin(time * swaySpeed + i * 0.5) * 0.05;
          dummy.rotation.set(
            item.rotation.x + swayAmount,
            item.rotation.y + swayAmount * 0.3,
            item.rotation.z
          );
        } else {
          dummy.rotation.copy(item.rotation);
        }
        
        dummy.scale.copy(item.scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
      
      mesh.instanceMatrix.needsUpdate = true;
    });
  });

  if (placementData.length === 0) return null;

  return (
    <>
      {validTypes.map(type => {
        const items = groupedData[type];
        const geometry = geometries[type];
        const material = materials[type];

        if (!geometry || items.length === 0) return null;

        return (
          <instancedMesh
            key={type}
            ref={el => { if (el) meshRefs.current[type] = el; }}
            args={[geometry, material, items.length]}
            frustumCulled={true}
          />
        );
      })}
    </>
  );
}

/**
 * Helper to flatten placementData object into array format
 * 
 * Usage in TrackSegment:
 * const flattenedPlacement = useMemo(() => flattenPlacementData(placementData), [placementData]);
 */
export function flattenPlacementData(
  placementData: Record<string, Array<{ position: Vector3; rotation: Euler; scale: Vector3 }>>,
  typeMap: Record<string, string> = {}
): PlacementItem[] {
  const flattened: PlacementItem[] = [];
  
  Object.entries(placementData).forEach(([key, items]) => {
    const type = typeMap[key] || key;
    if (Array.isArray(items)) {
      items.forEach(item => {
        flattened.push({
          type,
          position: item.position,
          rotation: item.rotation,
          scale: item.scale,
        });
      });
    }
  });
  
  return flattened;
}
