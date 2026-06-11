import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useBiome } from '../../systems/BiomeSystem';
import { useSunPosition } from '../../systems/SunPositionSystem';

const DUMMY_OBJ = new THREE.Object3D();
const MOTES_PER_SHAFT = 6;
const MAX_DUST_SHAFTS = 24;

// Build a static GPU-driven dust mote field scattered through each shaft's
// cylindrical volume. Motion (rise + drift + twinkle) is computed entirely in
// the vertex shader from per-vertex attributes, so no per-frame CPU work.
const buildDustMotes = (transforms) => {
  const shaftCount = Math.min(transforms.length, MAX_DUST_SHAFTS);
  const total = shaftCount * MOTES_PER_SHAFT;

  const basePositions = new Float32Array(total * 3);
  const heights = new Float32Array(total);
  const radii = new Float32Array(total);
  const phases = new Float32Array(total);
  const speeds = new Float32Array(total);

  const matrix = new THREE.Matrix4();
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();

  for (let s = 0; s < shaftCount; s++) {
    const t = transforms[s];
    matrix.compose(
      t.position,
      new THREE.Quaternion().setFromEuler(t.rotation || new THREE.Euler()),
      t.scale || new THREE.Vector3(1, 1, 1)
    );

    const shaftHeight = 30 * (t.scale?.y ?? 1);

    for (let m = 0; m < MOTES_PER_SHAFT; m++) {
      const idx = s * MOTES_PER_SHAFT + m;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 4; // within the wide base radius (cylinder bottom radius 6)
      const localY = (Math.random() - 0.5) * 30; // cylinder spans -15..15 locally

      local.set(Math.cos(a) * r, localY, Math.sin(a) * r);
      world.copy(local).applyMatrix4(matrix);

      basePositions[idx * 3] = world.x;
      basePositions[idx * 3 + 1] = world.y;
      basePositions[idx * 3 + 2] = world.z;

      heights[idx] = shaftHeight;
      radii[idx] = 0.15 + Math.random() * 0.35;
      phases[idx] = Math.random() * Math.PI * 2;
      speeds[idx] = 0.3 + Math.random() * 0.6;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(basePositions, 3));
  geo.setAttribute('aHeight', new THREE.BufferAttribute(heights, 1));
  geo.setAttribute('aRadius', new THREE.BufferAttribute(radii, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  return geo;
};

const DUST_MOTE_VERTEX = `
  uniform float time;
  uniform float flowSpeed;
  uniform float sunFacing;
  attribute float aHeight;
  attribute float aRadius;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vTwinkle;

  void main() {
    // Slow upward drift through the shaft, wrapping at the top so motes
    // appear to rise endlessly through the light.
    float rise = mod(time * (0.15 + flowSpeed * 0.08) * aSpeed + aPhase * aHeight, aHeight) - aHeight * 0.5;
    vec3 pos = position;
    pos.y += rise;
    pos.x += sin(time * aSpeed * 0.7 + aPhase * 6.2831) * 0.4;
    pos.z += cos(time * aSpeed * 0.6 + aPhase * 6.2831) * 0.4;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aRadius * sunFacing * (180.0 / -mvPosition.z);

    vTwinkle = 0.4 + 0.6 * (0.5 + 0.5 * sin(time * (1.5 + aSpeed) + aPhase * 9.0));
  }
`;

const DUST_MOTE_FRAGMENT = `
  uniform vec3 colorBase;
  uniform float opacity;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = smoothstep(0.5, 0.0, d);
    if (core <= 0.001) discard;
    gl_FragColor = vec4(colorBase, core * vTwinkle * opacity);
  }
`;

export default function SunShafts({
  transforms,
  flowSpeed = 1.0,
  isSlotCanyon = false,
}) {
  const meshRef = useRef();
  const dustRef = useRef();
  const motesRef = useRef();
  const { camera } = useThree();
  const { timeOfDay } = useBiome();
  const { sunWorldPosition } = useSunPosition();
  const prevCamPosRef = useRef(new THREE.Vector3());
  const streakStrengthRef = useRef(0);
  const [weatherType, setWeatherType] = useState('clear');

  useEffect(() => {
    const onWeatherUpdate = (event) => {
      const incoming = event?.detail?.type;
      if (typeof incoming === 'string') setWeatherType(incoming);
    };
    window.addEventListener('weather-update', onWeatherUpdate);
    return () => window.removeEventListener('weather-update', onWeatherUpdate);
  }, []);

  // Geometry: Cone/Cylinder representing the light beam
  const geometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(2, 6, 30, 8, 1, true);
    return geo;
  }, []);

  // Custom Shader Material for Volumetric Light
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false, // Don't occlude
      blending: THREE.AdditiveBlending, // Light adds up
      side: THREE.DoubleSide, // See from inside too
      uniforms: {
        time: { value: 0 },
        colorBase: { value: new THREE.Color('#fff6d8') }, // Slightly warmer golden sunlight
        warmTint: { value: new THREE.Color('#ffcc88') },
        flowSpeed: { value: flowSpeed },
        shaftOpacity: { value: isSlotCanyon ? 0.5 : 0.3 },
        timeOfDay: { value: timeOfDay },
        speedStreak: { value: 0 },
        sunDirection: { value: new THREE.Vector3(0.1, 1.0, 0.05).normalize() },
        overcastBlend: { value: 0 },
      },
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vAlpha;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123); }

        void main() {
          vUv = uv;

          // Instance info for randomness
          vec3 instancePos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float rand = hash(instancePos.xz * 12.0);

          // Subtle sway animation
          vec3 pos = position;
          float swaySpeed = 0.5 + rand * 0.5;
          pos.x += sin(time * swaySpeed + pos.y * 0.1 + rand * 10.0) * 0.5;

          // Calculate world position for noise in fragment shader
          vec4 worldPosition = modelMatrix * instanceMatrix * vec4(pos, 1.0);
          vWorldPosition = worldPosition.xyz;

          gl_Position = projectionMatrix * viewMatrix * worldPosition;

          // Randomize intensity slightly per shaft
          vAlpha = 0.6 + rand * 0.4;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 colorBase;
        uniform vec3 warmTint;
        uniform float flowSpeed;
        uniform float shaftOpacity;
        uniform float timeOfDay;
        uniform float speedStreak;
        uniform vec3 sunDirection;
        uniform float overcastBlend;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vAlpha;

        // 3D Noise function (Simplex-ish)
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

        float snoise(vec3 v) {
            const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
            const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy) );
            vec3 x0 = v - i + dot(i, C.xxx) ;
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy; // 2.0*C.x = 1/3 = C.y
            vec3 x3 = x0 - D.yyy;      // -1.0+3.0*C.x = -0.5 = -D.y
            i = mod289(i);
            vec4 p = permute( permute( permute(
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
            float n_ = 0.142857142857; // 1.0/7.0
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);  //  mod(p,7*7)
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );    // mod(j,N)
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
            vec3 p0 = vec3(a0.xy,h.x);
            vec3 p1 = vec3(a0.zw,h.y);
            vec3 p2 = vec3(a1.xy,h.z);
            vec3 p3 = vec3(a1.zw,h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                        dot(p2,x2), dot(p3,x3) ) );
        }

        void main() {
          // Vertical Fade (Soft top and bottom)
          // uv.y goes from 0 to 1
          float verticalFade = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.8, 1.0, vUv.y));

          // Layered volumetric noise: a coarse "shaft mass" layer plus a finer,
          // faster-drifting layer for internal swirl/turbulence.
          float noiseA = snoise(vWorldPosition * 0.3 + vec3(0.0, -time * (0.5 + flowSpeed * 0.3), 0.0));
          noiseA = noiseA * 0.5 + 0.5;
          float shaftA = smoothstep(0.3, 0.7, noiseA);

          float noiseB = snoise(vWorldPosition * 0.9 + vec3(time * 0.12, -time * (0.9 + flowSpeed * 0.5), time * 0.08));
          noiseB = noiseB * 0.5 + 0.5;
          float shaftB = smoothstep(0.35, 0.75, noiseB);

          float shaft = shaftA * (0.65 + 0.35 * shaftB);

          // Edge glow: shafts read brighter near their core (uv.x ~ angle around
          // the cylinder), simulating a view-angle / fresnel response.
          float edge = pow(1.0 - abs(vUv.x * 2.0 - 1.0), 1.5);
          shaft *= (0.55 + 0.45 * edge);

          // Dust streak accents when player is moving quickly.
          float streaks = sin((vUv.y + time * (1.2 + flowSpeed * 0.6)) * 35.0 + vUv.x * 20.0) * 0.5 + 0.5;
          streaks = smoothstep(0.82, 1.0, streaks) * speedStreak;

          // Time-of-day modulation: strongest at midday with warmer amber toward golden hour.
          float midday = max(0.0, 1.0 - abs(timeOfDay - 0.5) * 2.0);
          float goldenHour = smoothstep(0.65, 0.9, timeOfDay);
          vec3 shaftColor = mix(colorBase, warmTint, goldenHour * 0.7 + (1.0 - midday) * 0.1);
          float sunFacing = clamp(dot(normalize(sunDirection), vec3(0.0, 1.0, 0.0)), 0.2, 1.0);

          // Overcast weather: flatten contrast and desaturate into soft, diffuse god rays.
          shaft = mix(shaft, 0.45, overcastBlend * 0.6);
          shaftColor = mix(shaftColor, vec3(0.82, 0.85, 0.9), overcastBlend * 0.7);
          float overcastDim = mix(1.0, 0.55, overcastBlend);

          // Combine
          float alpha = vAlpha * verticalFade * shaft * shaftOpacity * (0.65 + midday * 0.35) * sunFacing * overcastDim;
          alpha += streaks * 0.12 * (1.0 - overcastBlend * 0.6);

          gl_FragColor = vec4(shaftColor, alpha);
        }
      `
    });

    return mat;
  }, [flowSpeed, isSlotCanyon, timeOfDay]);

  const dustGeometry = useMemo(() => new THREE.PlaneGeometry(0.12, 1.0), []);
  const dustMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#fff4d0',
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);

  const moteGeometry = useMemo(() => (transforms ? buildDustMotes(transforms) : null), [transforms]);
  const moteMaterial = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      flowSpeed: { value: flowSpeed },
      colorBase: { value: new THREE.Color('#fff6d8') },
      opacity: { value: isSlotCanyon ? 0.55 : 0.35 },
      sunFacing: { value: 1.0 },
    },
    vertexShader: DUST_MOTE_VERTEX,
    fragmentShader: DUST_MOTE_FRAGMENT,
  }), [flowSpeed, isSlotCanyon]);

  useFrame((state) => {
    const dt = Math.max(0.0001, state.clock.getDelta());
    const camDelta = camera.position.distanceTo(prevCamPosRef.current);
    prevCamPosRef.current.copy(camera.position);
    const cameraSpeed = camDelta / dt;
    const targetStreak = THREE.MathUtils.clamp(cameraSpeed / 30, 0, 1);
    streakStrengthRef.current = THREE.MathUtils.lerp(streakStrengthRef.current, targetStreak, 0.12);

    const overcastBlend = (weatherType === 'overcast' || weatherType === 'storm') ? 1 : weatherType === 'fog' ? 0.6 : 0;

    if (material.uniforms) {
      material.uniforms.time.value = state.clock.elapsedTime;
      material.uniforms.flowSpeed.value = flowSpeed;
      material.uniforms.shaftOpacity.value = isSlotCanyon ? 0.5 : 0.3;
      material.uniforms.timeOfDay.value = timeOfDay;
      material.uniforms.speedStreak.value = streakStrengthRef.current;
      material.uniforms.sunDirection.value.copy(sunWorldPosition).normalize();
      material.uniforms.overcastBlend.value = overcastBlend;
    }

    if (dustMaterial) {
      dustMaterial.opacity = (isSlotCanyon ? 0.2 : 0.12) + streakStrengthRef.current * 0.18 * (1 - overcastBlend * 0.6);
    }

    if (moteMaterial.uniforms) {
      moteMaterial.uniforms.time.value = state.clock.elapsedTime;
      moteMaterial.uniforms.flowSpeed.value = flowSpeed;
      const sunFacing = THREE.MathUtils.clamp(sunWorldPosition.y / 60, 0.25, 1.0);
      moteMaterial.uniforms.sunFacing.value = sunFacing * (1 - overcastBlend * 0.5);
    }
  }, 0);

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;
    const dustMesh = dustRef.current;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation);
      DUMMY_OBJ.scale.copy(t.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
      if (dustMesh) {
        const dustScale = t.scale.clone().multiply(new THREE.Vector3(0.18, 0.55, 0.18));
        DUMMY_OBJ.scale.copy(dustScale);
        DUMMY_OBJ.updateMatrix();
        dustMesh.setMatrixAt(i, DUMMY_OBJ.matrix);
      }
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (dustMesh) {
      dustMesh.instanceMatrix.needsUpdate = true;
    }
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, transforms.length]}
        frustumCulled={false}
        renderOrder={1}
      />
      <instancedMesh
        ref={dustRef}
        args={[dustGeometry, dustMaterial, transforms.length]}
        frustumCulled={false}
        renderOrder={2}
      />
      {moteGeometry && (
        <points ref={motesRef} geometry={moteGeometry} material={moteMaterial} frustumCulled={false} renderOrder={3} />
      )}
    </group>
  );
}
