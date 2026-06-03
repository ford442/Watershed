import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;

  uniform float time;
  uniform float opacity;
  uniform vec3 sunDirection;

  vec3 hsl2rgb(float h, float s, float l) {
    float c = (1.0 - abs(2.0 * l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c / 2.0;
    vec3 rgb;
    if (h < 1.0/6.0) rgb = vec3(c, x, 0.0);
    else if (h < 2.0/6.0) rgb = vec3(x, c, 0.0);
    else if (h < 3.0/6.0) rgb = vec3(0.0, c, x);
    else if (h < 4.0/6.0) rgb = vec3(0.0, x, c);
    else if (h < 5.0/6.0) rgb = vec3(x, 0.0, c);
    else rgb = vec3(c, 0.0, x);
    return rgb + m;
  }

  void main() {
    float hue = (1.0 - vUv.x) * 0.75;
    vec3 rainbow = hsl2rgb(hue, 0.95, 0.60);

    float innerEdge = smoothstep(0.0, 0.18, vUv.y);
    float outerEdge = 1.0 - smoothstep(0.82, 1.0, vUv.y);
    float widthMask = innerEdge * outerEdge;

    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float fresnel = pow(1.0 - clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0), 1.8);
    float shimmer = 0.92 + 0.08 * sin(time * 0.9 + vUv.x * 10.0);
    float sunLift = 0.7 + 0.3 * clamp(dot(normalize(sunDirection), vec3(0.0, 1.0, 0.0)), 0.0, 1.0);

    float alpha = opacity * widthMask * fresnel * shimmer * sunLift;
    if (alpha <= 0.001) discard;

    gl_FragColor = vec4(rainbow, alpha);
  }
`;

export default function Rainbow({
  opacity = 0.4,
  sunDirection = new THREE.Vector3(0.1, 1.0, 0.1),
}) {
  const materialRef = useRef(null);

  const geometry = useMemo(() => {
    // Arc radius ~8 units, half-torus segment.
    const geo = new THREE.TorusGeometry(8, 0.55, 8, 64, Math.PI);
    return geo;
  }, []);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        time: { value: 0 },
        opacity: { value: opacity },
        sunDirection: { value: sunDirection.clone().normalize() },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }, []);

  useFrame((state) => {
    if (!materialRef.current?.uniforms) return;
    materialRef.current.uniforms.time.value = state.clock.elapsedTime;
    materialRef.current.uniforms.opacity.value = opacity;
    materialRef.current.uniforms.sunDirection.value.copy(sunDirection).normalize();
  });

  return <mesh geometry={geometry} material={material} ref={materialRef} />;
}
