import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();
const LOCAL_FORWARD = new THREE.Vector3(0, 0, 1);
const TEMP_POS = new THREE.Vector3();
const TEMP_VEL = new THREE.Vector3();
const TEMP_OFFSET = new THREE.Vector3();
const TEMP_QUAT = new THREE.Quaternion();
const FLAP_QUAT = new THREE.Quaternion();
const RIGHT_WING_FLAP_QUAT = new THREE.Quaternion();
const ROLL_QUAT = new THREE.Quaternion();
const TEMP_AXIS = new THREE.Vector3(0, 0, 1);
const PREV_POS = new THREE.Vector3();
const PREV_VEL = new THREE.Vector3();
const FLEE_DIR = new THREE.Vector3();
const MAX_BIRDS = 8;
const STARTLE_RADIUS = 7;

const hash = (n) => {
  const x = Math.sin(n) * 43758.5453123;
  return x - Math.floor(x);
};

const createWingGeometry = (side, config) => {
  const { span, chord, sweep, tipDrop } = config;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
   0, 0, 0,
   side * span, tipDrop, -sweep,
   side * (span * 0.78), tipDrop * 0.6, -(sweep + chord),
   side * (span * 0.2), 0, -(chord * 0.45),
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeVertexNormals();

  // Vertex-color gradient: lighter near the body, darkening toward the
  // primary feather tips so wings read with a bit of depth/shading.
  const colors = new Float32Array([
   1.0, 1.0, 1.0,
   0.62, 0.62, 0.62,
   0.5, 0.5, 0.5,
   0.8, 0.8, 0.8,
  ]);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
};

const quadraticBezier = (target, p0, p1, p2) => {
  const inv = 1 - target;
  const inv2 = inv * inv;
  const t2 = target * target;
  return {
   x: inv2 * p0.x + 2 * inv * target * p1.x + t2 * p2.x,
   y: inv2 * p0.y + 2 * inv * target * p1.y + t2 * p2.y,
   z: inv2 * p0.z + 2 * inv * target * p1.z + t2 * p2.z,
  };
};

const evaluateSongbird = (bird, time, outPos, outVel) => {
  const cycle = (time * bird.motionFreq + bird.phase) % 1;
  const hopFraction = 0.38;
  const hopTarget = { x: bird.hopX, y: bird.hopY, z: bird.hopZ };
  const hopMid = { x: bird.hopX * 0.35, y: bird.hopHeight, z: bird.hopZ * 0.35 };
  const glideMid = { x: bird.hopX * 0.42, y: bird.hopY * 0.45, z: bird.hopZ * 0.42 };

  const localPos = cycle < hopFraction
   ? quadraticBezier(cycle / hopFraction, { x: 0, y: 0, z: 0 }, hopMid, hopTarget)
   : quadraticBezier(
     (cycle - hopFraction) / (1 - hopFraction),
     hopTarget,
     glideMid,
     { x: 0, y: 0, z: 0 }
   );

  const offsetJitter = Math.sin(time * 6.0 + bird.phase * 7.0) * bird.jitterAmp;
  const verticalJitter = Math.sin(time * 8.5 + bird.phase * 4.0) * bird.jitterAmp * 0.55;

  outPos.set(
   bird.anchor.x + localPos.x + offsetJitter,
   bird.anchor.y + localPos.y + verticalJitter,
   bird.anchor.z + localPos.z + offsetJitter * 0.6
  );

  const sampleDt = 0.03;
  const nextCycle = (cycle + sampleDt) % 1;
  const nextLocal = nextCycle < hopFraction
   ? quadraticBezier(nextCycle / hopFraction, { x: 0, y: 0, z: 0 }, hopMid, hopTarget)
   : quadraticBezier(
     (nextCycle - hopFraction) / (1 - hopFraction),
     hopTarget,
     glideMid,
     { x: 0, y: 0, z: 0 }
   );

  outVel.set(
   (nextLocal.x - localPos.x) / sampleDt,
   (nextLocal.y - localPos.y) / sampleDt + Math.cos(time * 8.5 + bird.phase * 4.0) * bird.jitterAmp * 0.55,
   (nextLocal.z - localPos.z) / sampleDt
  );

  const glideAlpha = cycle < hopFraction ? 0 : (cycle - hopFraction) / (1 - hopFraction);
  return {
   flap: Math.sin(time * bird.flapFreq + bird.phase * Math.PI * 2) * (0.9 - glideAlpha * 0.45),
  };
};

const evaluateHawk = (bird, time, outPos, outVel) => {
  const angle = time * bird.motionFreq + bird.phase * Math.PI * 2;
  const angle2 = angle * 0.83 + bird.phase * 0.5;

  const x = Math.cos(angle) * bird.radiusX;
  const z = Math.sin(angle2) * bird.radiusZ;
  const y = Math.sin(angle * 0.3 + bird.phase * 1.5) * bird.riseAmp;

  outPos.set(bird.anchor.x + x, bird.anchor.y + y, bird.anchor.z + z);

  outVel.set(
   -Math.sin(angle) * bird.motionFreq * bird.radiusX,
   Math.cos(angle * 0.3 + bird.phase * 1.5) * bird.motionFreq * 0.3 * bird.riseAmp,
   Math.cos(angle2) * bird.motionFreq * 0.83 * bird.radiusZ
  );

  return {
   flap: Math.sin(time * bird.flapFreq + bird.phase * Math.PI * 2) * 0.25,
  };
};

export default function Birds({ transforms, birdType = 'songbird', isNight = false }) {
  const bodyRef = useRef();
  const leftWingRef = useRef();
  const rightWingRef = useRef();

  const activeTransforms = useMemo(
   () => (Array.isArray(transforms) ? transforms.slice(0, MAX_BIRDS) : []),
   [transforms]
  );

  const birds = useMemo(() => {
   const isHawk = birdType === 'hawk';
   return activeTransforms.map((transform, index) => {
     const basePos = transform.position || new THREE.Vector3();
     const seedBase = (basePos.x * 13.31) + (basePos.y * 7.17) + (basePos.z * 5.27) + index * 17.11;
     const r1 = hash(seedBase);
     const r2 = hash(seedBase + 2.17);
     const r3 = hash(seedBase + 5.73);
     const r4 = hash(seedBase + 8.91);
     const r5 = hash(seedBase + 12.37);

     const scale = isHawk ? (1.25 + r1 * 0.35) : (0.55 + r1 * 0.3);

     if (isHawk) {
       return {
         anchor: new THREE.Vector3(basePos.x, basePos.y + 16 + r2 * 6, basePos.z),
         phase: r3,
         motionFreq: 0.22 + r4 * 0.14,
         flapFreq: 0.8 + r5 * 0.35,
         radiusX: 9 + r1 * 8,
         radiusZ: 7 + r2 * 6,
         riseAmp: 1.5 + r3 * 2.2,
         wingRootOffset: 0.04,
         wingRootLift: 0.03,
         scale,
       };
     }

     return {
       anchor: new THREE.Vector3(basePos.x, basePos.y + 3 + r2 * 3, basePos.z),
       phase: r3,
       motionFreq: 0.95 + r4 * 0.9,
       flapFreq: 6.4 + r5 * 3.0,
       hopX: (r1 - 0.5) * 5.0,
       hopZ: (r2 - 0.5) * 5.0,
       hopY: 0.6 + r3 * 1.4,
       hopHeight: 1.6 + r4 * 2.0,
       jitterAmp: 0.2 + r5 * 0.25,
       wingRootOffset: 0.025,
       wingRootLift: 0.015,
       scale,
     };
   });
  }, [activeTransforms, birdType]);

  const bodyGeometry = useMemo(() => {
   const isHawk = birdType === 'hawk';
   const geo = new THREE.CapsuleGeometry(isHawk ? 0.08 : 0.055, isHawk ? 0.38 : 0.25, 4, 8);
   geo.rotateX(Math.PI / 2);
   return geo;
  }, [birdType]);

  const leftWingGeometry = useMemo(() => {
   const isHawk = birdType === 'hawk';
   return createWingGeometry(1, isHawk
     ? { span: 0.95, chord: 0.52, sweep: 0.42, tipDrop: -0.04 }
     : { span: 0.52, chord: 0.24, sweep: 0.18, tipDrop: 0.06 });
  }, [birdType]);

  const rightWingGeometry = useMemo(() => {
   const isHawk = birdType === 'hawk';
   return createWingGeometry(-1, isHawk
     ? { span: 0.95, chord: 0.52, sweep: 0.42, tipDrop: -0.04 }
     : { span: 0.52, chord: 0.24, sweep: 0.18, tipDrop: 0.06 });
  }, [birdType]);

  const bodyMaterial = useMemo(() => {
   return new THREE.MeshStandardMaterial({
     color: birdType === 'hawk' ? '#6f5842' : '#f0efea',
     roughness: 0.82,
     metalness: 0.02,
   });
  }, [birdType]);

  const wingMaterial = useMemo(() => {
   return new THREE.MeshStandardMaterial({
     color: birdType === 'hawk' ? '#5a4835' : '#ecebe3',
     roughness: 0.86,
     metalness: 0.01,
     side: THREE.DoubleSide,
     vertexColors: true,
   });
  }, [birdType]);

  useFrame(({ clock, camera }) => {
   if (!bodyRef.current || !leftWingRef.current || !rightWingRef.current || birds.length === 0) return;

   const now = clock.elapsedTime;
   const evaluate = birdType === 'hawk' ? evaluateHawk : evaluateSongbird;

   birds.forEach((bird, index) => {
     const motion = evaluate(bird, now, TEMP_POS, TEMP_VEL);

     if (TEMP_VEL.lengthSq() < 1e-4) {
       TEMP_VEL.set(0, 0, 1);
     }
     TEMP_VEL.normalize();

     // Startle response: birds near the player veer away and flap harder
     const distToCam = TEMP_POS.distanceTo(camera.position);
     let flapMul = 1;
     if (distToCam < STARTLE_RADIUS) {
       const proximity = 1 - distToCam / STARTLE_RADIUS;
       FLEE_DIR.copy(TEMP_POS).sub(camera.position).normalize();
       TEMP_VEL.lerp(FLEE_DIR, 0.5 + proximity * 0.4).normalize();
       flapMul = 1.6 + proximity * 1.4;
     }

     TEMP_QUAT.setFromUnitVectors(LOCAL_FORWARD, TEMP_VEL);

     // Banking tilt: roll into turns based on heading change over a short window
     evaluate(bird, now - 0.08, PREV_POS, PREV_VEL);
     if (PREV_VEL.lengthSq() < 1e-4) PREV_VEL.set(0, 0, 1);
     const heading = Math.atan2(TEMP_VEL.x, TEMP_VEL.z);
     const headingPrev = Math.atan2(PREV_VEL.x, PREV_VEL.z);
     let yawDelta = heading - headingPrev;
     if (yawDelta > Math.PI) yawDelta -= Math.PI * 2;
     if (yawDelta < -Math.PI) yawDelta += Math.PI * 2;
     const bank = THREE.MathUtils.clamp(-yawDelta * 6, -0.9, 0.9);
     ROLL_QUAT.setFromAxisAngle(LOCAL_FORWARD, bank);
     TEMP_QUAT.multiply(ROLL_QUAT);

     DUMMY_OBJ.position.copy(TEMP_POS);
     DUMMY_OBJ.quaternion.copy(TEMP_QUAT);
     DUMMY_OBJ.scale.setScalar(bird.scale);
     DUMMY_OBJ.updateMatrix();
     bodyRef.current.setMatrixAt(index, DUMMY_OBJ.matrix);

     FLAP_QUAT.setFromAxisAngle(TEMP_AXIS, motion.flap * flapMul);
     RIGHT_WING_FLAP_QUAT.setFromAxisAngle(TEMP_AXIS, -motion.flap * flapMul);

     TEMP_OFFSET.set(-bird.wingRootOffset, bird.wingRootLift, 0).applyQuaternion(TEMP_QUAT);
     DUMMY_OBJ.position.copy(TEMP_POS).add(TEMP_OFFSET);
     DUMMY_OBJ.quaternion.copy(TEMP_QUAT).multiply(FLAP_QUAT);
     DUMMY_OBJ.scale.setScalar(bird.scale);
     DUMMY_OBJ.updateMatrix();
     leftWingRef.current.setMatrixAt(index, DUMMY_OBJ.matrix);

     TEMP_OFFSET.set(bird.wingRootOffset, bird.wingRootLift, 0).applyQuaternion(TEMP_QUAT);
     DUMMY_OBJ.position.copy(TEMP_POS).add(TEMP_OFFSET);
     DUMMY_OBJ.quaternion.copy(TEMP_QUAT).multiply(RIGHT_WING_FLAP_QUAT);
     DUMMY_OBJ.scale.setScalar(bird.scale);
     DUMMY_OBJ.updateMatrix();
     rightWingRef.current.setMatrixAt(index, DUMMY_OBJ.matrix);
   });

   bodyRef.current.instanceMatrix.needsUpdate = true;
   leftWingRef.current.instanceMatrix.needsUpdate = true;
   rightWingRef.current.instanceMatrix.needsUpdate = true;
  });

  if (isNight || birds.length === 0) return null;

  return (
   <group>
     <instancedMesh
       ref={bodyRef}
       args={[bodyGeometry, bodyMaterial, birds.length]}
       frustumCulled={false}
       castShadow
     />
     <instancedMesh
       ref={leftWingRef}
       args={[leftWingGeometry, wingMaterial, birds.length]}
       frustumCulled={false}
       castShadow
     />
     <instancedMesh
       ref={rightWingRef}
       args={[rightWingGeometry, wingMaterial, birds.length]}
       frustumCulled={false}
       castShadow
     />
   </group>
  );
}
