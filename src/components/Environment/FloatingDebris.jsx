import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { InstancedRigidBodies } from '@react-three/rapier';
import { useDriftwoodAssets, usePineconeAssets } from './DebrisAssets';

export default function FloatingDebris({ 
  path, // The CatmullRomCurve3
  waterLevel = 0.5,
  count = 12,
  seed = 0
}) {
    // Assets
    const driftwood = useDriftwoodAssets();
    const pinecone = usePineconeAssets();

    // Cache path length for speed calculation
    const pathLength = useMemo(() => path ? path.getLength() : 1, [path]);

    // Generate Debris Data
    const debris = useMemo(() => {
        if (!path) return [];

        const items = [];
        const seededRandom = (s) => {
            const x = Math.sin(s) * 10000;
            return x - Math.floor(x);
        };
        let currentSeed = seed;

        for (let i = 0; i < count; i++) {
            // Determine type: 30% Driftwood, 70% Pinecones
            const type = seededRandom(currentSeed++) > 0.7 ? 'driftwood' : 'pinecone';

            // Initial T (position along path)
            const t = seededRandom(currentSeed++);

            // Lateral Offset (from center line)
            // +/- 2.5 width (Approx 5m wide safe zone)
            const lateralOffset = (seededRandom(currentSeed++) - 0.5) * 5.0;

            // Random Rotation speed/axis
            const rotationSpeed = new THREE.Vector3(
                seededRandom(currentSeed++),
                seededRandom(currentSeed++),
                seededRandom(currentSeed++)
            ).subScalar(0.5).multiplyScalar(2.0);

            // Scale
            let scale;
            if (type === 'driftwood') {
                 const s = 0.5 + seededRandom(currentSeed++) * 0.5;
                 scale = [s, s, s];
            } else {
                 const s = 0.4 + seededRandom(currentSeed++) * 0.3;
                 scale = [s, s, s];
            }

            items.push({
                key: i, // Unique key per group
                type,
                t, // Current progress (0-1)
                lateralOffset,
                rotationSpeed,
                scale,
                position: [0, -50, 0], // Hidden initially
                rotation: [0,0,0]
            });
        }
        return items;
    }, [path, count, seed]);

    // Separate into two arrays for the two InstancedRigidBodies
    const driftwoodInstances = useMemo(() => debris.filter(d => d.type === 'driftwood'), [debris]);
    const pineconeInstances = useMemo(() => debris.filter(d => d.type === 'pinecone'), [debris]);

    const driftwoodRef = useRef([]);
    const pineconeRef = useRef([]);

    useFrame((state, delta) => {
        if (!path) return;

        // Helper to update a list of instances
        const updateInstances = (instances, ref) => {
             if (!ref.current || ref.current.length === 0) return;

             // Flow speed: 2.5 units/sec
             const tSpeed = (2.5 * delta) / pathLength;

             // We use a dummy object for rotation calc
             const dummyObj = new THREE.Object3D();
             const normal = new THREE.Vector3(0,1,0);

             instances.forEach((item, i) => {
                 // Update T
                 item.t += tSpeed;
                 if (item.t > 1.0) item.t -= 1.0;

                 // Calculate Position on Curve
                 const point = path.getPointAt(item.t);
                 const tangent = path.getTangentAt(item.t).normalize();
                 const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

                 // Apply lateral offset
                 point.add(binormal.multiplyScalar(item.lateralOffset));

                 // Bobbing
                 point.y = waterLevel - 0.1 + Math.sin(state.clock.elapsedTime * 2.0 + item.key) * 0.05;

                 // Rotation: Align with flow + Tumble
                 dummyObj.position.copy(point);
                 dummyObj.lookAt(point.clone().add(tangent));

                 // Add tumble based on time
                 if (item.type === 'driftwood') {
                    // Logs roll in the water
                    dummyObj.rotateZ(state.clock.elapsedTime * item.rotationSpeed.z);
                 } else {
                    // Pinecones bob/spin
                    dummyObj.rotateX(state.clock.elapsedTime * item.rotationSpeed.x);
                    dummyObj.rotateY(state.clock.elapsedTime * item.rotationSpeed.y);
                 }

                 // Apply to Physics Body
                 // Note: ref.current[i] might be null if body hasn't initialized yet
                 const rb = ref.current[i];
                 if (rb) {
                     rb.setNextKinematicTranslation(point);
                     rb.setNextKinematicRotation(dummyObj.quaternion);
                 }
             });
        };

        updateInstances(driftwoodInstances, driftwoodRef);
        updateInstances(pineconeInstances, pineconeRef);
    });

    if (!path) return null;

    return (
        <group>
            {driftwoodInstances.length > 0 && (
                <InstancedRigidBodies
                    ref={driftwoodRef}
                    instances={driftwoodInstances}
                    colliders="hull"
                    type="kinematicPosition"
                >
                    <instancedMesh
                        args={[driftwood.geometry, driftwood.material, driftwoodInstances.length]}
                        receiveShadow
                        castShadow
                    />
                </InstancedRigidBodies>
            )}

            {pineconeInstances.length > 0 && (
                <InstancedRigidBodies
                    ref={pineconeRef}
                    instances={pineconeInstances}
                    colliders="hull"
                    type="kinematicPosition"
                >
                    <instancedMesh
                        args={[pinecone.geometry, pinecone.material, pineconeInstances.length]}
                        receiveShadow
                        castShadow
                    />
                </InstancedRigidBodies>
            )}
        </group>
    );
}
