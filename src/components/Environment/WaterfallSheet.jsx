import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

const noiseHelpers = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    v += noise(p) * 0.55;
    p = p * 2.0 + vec2(3.1, 1.7);
    v += noise(p) * 0.3;
    p = p * 2.0 + vec2(1.2, 4.8);
    v += noise(p) * 0.15;
    return v;
  }
`;

export default function WaterfallSheet({
  width = 10,
  height = 20,
  flowSpeed = 1.2,
  fanAngle = 0,
}) {
  const coreRef = useRef(null);
  const overlayRef = useRef(null);

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

  const makeMaterial = (layerSpeed, opacity, offset) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      time: { value: 0 },
      flowSpeed: { value: flowSpeed * layerSpeed },
      baseOpacity: { value: opacity },
      layerOffset: { value: offset },
      waterColor: { value: new THREE.Color('#8fd8ff') },
      deepColor: { value: new THREE.Color('#dff7ff') },
      foamColor: { value: new THREE.Color('#ffffff') },
    },
    vertexShader: `
      uniform float time;
      uniform float flowSpeed;
      uniform float layerOffset;
      attribute float curtainDepth;
      varying vec2 vUv;
      varying float vDepth;
      varying float vFoamBias;
      varying vec3 vWorldPos;
      ${noiseHelpers}

      void main() {
        vUv = uv;
        vDepth = curtainDepth;
        float billow = sin((position.y * 0.18) + time * 0.8 + layerOffset) * 0.12;
        billow += fbm(vec2(position.x * 0.14 + layerOffset, position.y * 0.08 - time * 0.35)) * 0.18;
        float basePull = smoothstep(0.45, 1.0, curtainDepth) * 0.25;
        vec3 transformed = position;
        transformed.x += billow * (0.45 + curtainDepth * 0.55);
        transformed.z += basePull + sin(position.x * 0.2 + time * 0.5 + layerOffset) * 0.08;
        vFoamBias = smoothstep(0.55, 1.0, curtainDepth);
        vec4 worldPos = modelMatrix * vec4(transformed, 1.0);
        vWorldPos = worldPos.xyz;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float flowSpeed;
      uniform float baseOpacity;
      uniform float layerOffset;
      uniform vec3 waterColor;
      uniform vec3 deepColor;
      uniform vec3 foamColor;
      varying vec2 vUv;
      varying float vDepth;
      varying float vFoamBias;
      varying vec3 vWorldPos;
      ${noiseHelpers}

      void main() {
        vec2 streakUv = vec2(vUv.x * 1.9 + layerOffset, (1.0 - vUv.y) * 3.6 + time * flowSpeed * 2.8);
        float streaks = fbm(streakUv);
        float foam = smoothstep(0.52, 0.84, streaks);
        float edgeThin = smoothstep(0.0, 0.16, vUv.x) * (1.0 - smoothstep(0.84, 1.0, vUv.x));
        float baseFoam = smoothstep(0.62, 1.0, vDepth);
        float lipFade = 1.0 - smoothstep(0.0, 0.12, vUv.y);
        vec3 color = mix(waterColor, deepColor, smoothstep(0.05, 0.9, vDepth));
        color += foamColor * foam * (0.16 + baseFoam * 0.55);
        color += foamColor * baseFoam * 0.24;
        float fresnel = pow(1.0 - abs(dot(normalize(cameraPosition - vWorldPos), vec3(0.0, 0.0, 1.0))), 2.0);
        color += vec3(0.12, 0.18, 0.22) * fresnel;
        float alpha = baseOpacity * edgeThin * (0.55 + foam * 0.2 + baseFoam * 0.35);
        alpha *= (1.0 - lipFade * 0.22);
        gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.95));
      }
    `,
  });

  const coreMaterial = useMemo(() => makeMaterial(1.0, 0.72, 0.0), [flowSpeed]);
  const overlayMaterial = useMemo(() => makeMaterial(1.45, 0.34, 1.7), [flowSpeed]);

  useFrame((state) => {
    if (coreRef.current) {
      coreRef.current.material.uniforms.time.value = state.clock.elapsedTime;
    }
    if (overlayRef.current) {
      overlayRef.current.material.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  return (
    <group position={[0, -height * 0.5 + 0.4, -0.4]}>
      <mesh ref={coreRef} geometry={geometry} material={coreMaterial} frustumCulled={false} />
      <mesh ref={overlayRef} geometry={geometry} material={overlayMaterial} position={[0, 0, -0.18]} frustumCulled={false} />
    </group>
  );
}
