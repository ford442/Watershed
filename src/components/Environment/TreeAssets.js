import { useMemo } from 'react';
import * as THREE from 'three';
import { mergeBufferGeometries } from 'three-stdlib';

export function useTreeAssets() {
  const { trunkGeometry, foliageGeometry } = useMemo(() => {
    // 1. Trunk Geometry
    // Height 1.5, Radius 0.2. Base at Y=0.
    const trunkGeo = new THREE.CylinderGeometry(0.15, 0.25, 1.5, 6);
    trunkGeo.translate(0, 0.75, 0); // Move base to 0
    trunkGeo.computeVertexNormals();

    // 2. Foliage Geometry (3 Stacked Cones)
    const foliageGeos = [];

    // Bottom Cone (Wide)
    const cone1 = new THREE.ConeGeometry(1.3, 1.8, 7);
    cone1.translate(0, 0.9 + 1.2, 0); // Base ~1.2 (overlap trunk), Center 1.2 + 0.9 = 2.1
    // Actually, ConeGeometry(radius, height, radialSegments)
    // Center is at 0. Height 1.8. Extends -0.9 to 0.9.
    // We want base at 1.0. So center should be 1.0 + 0.9 = 1.9.
    cone1.translate(0, 1.9, 0);
    foliageGeos.push(cone1);

    // Middle Cone
    const cone2 = new THREE.ConeGeometry(1.0, 1.6, 7);
    // Base at 2.2. Height 1.6. Center at 2.2 + 0.8 = 3.0.
    cone2.translate(0, 3.0, 0);
    foliageGeos.push(cone2);

    // Top Cone
    const cone3 = new THREE.ConeGeometry(0.7, 1.4, 7);
    // Base at 3.3. Height 1.4. Center at 3.3 + 0.7 = 4.0.
    cone3.translate(0, 4.0, 0);
    foliageGeos.push(cone3);

    // Merge foliage
    const mergedFoliage = mergeBufferGeometries(foliageGeos);
    mergedFoliage.computeVertexNormals();

    return {
      trunkGeometry: trunkGeo,
      foliageGeometry: mergedFoliage
    };
  }, []);

  return { trunkGeometry, foliageGeometry };
}
