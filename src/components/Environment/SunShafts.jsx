import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const DUMMY_OBJ = new THREE.Object3D();

export default function SunShafts({ transforms }) {
  const meshRef = useRef();

  // Geometry: Cone/Cylinder representing the light beam
  // Top radius smaller (2), Bottom radius larger (6), Height 30
  // OpenEnded because we don't need caps
  const geometry = useMemo(() => {
    const geo = new THREE.CylinderGeometry(2, 6, 30, 8, 1, true);
    // Move origin to the top of the beam so scaling/rotation is easier?
    // Actually center is fine, but let's shift it up so y=0 is the bottom or top?
    // Let's keep center at 0,0,0 for now, height 30 means -15 to +15.
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
        colorBase: { value: new THREE.Color('#fffbe6') }, // Warm sunlight
      },
      vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying vec3 vWorldPosition;
        varying float vAlpha;

        // Hash for randomness
        float hash(float n) { return fract(sin(n) * 43758.5453123); }

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

          // Fresnel / Edge fade (Simulated by View Dir vs Normal? No, cylinder is tricky)
          // Simple approximation: fade edges based on view angle would be ideal but expensive.
          // Instead, let's just use the noise to break it up.

          // Dust Motes Noise
          // Move noise upwards and slowly
          float noise = snoise(vWorldPosition * 0.3 + vec3(0.0, -time * 0.5, 0.0));
          noise = noise * 0.5 + 0.5; // 0 to 1

          // Enhance contrast of noise for "shaft" look
          float shaft = smoothstep(0.3, 0.7, noise);

          // Combine
          float alpha = vAlpha * verticalFade * shaft * 0.3; // Low opacity base

          gl_FragColor = vec4(colorBase, alpha);
        }
      `
    });

    return mat;
  }, []);

  useFrame((state) => {
    if (material.uniforms) {
      material.uniforms.time.value = state.clock.elapsedTime;
    }
  });

  // Setup Instances
  useEffect(() => {
    if (!meshRef.current || !transforms || transforms.length === 0) return;

    const mesh = meshRef.current;

    transforms.forEach((t, i) => {
      DUMMY_OBJ.position.copy(t.position);
      DUMMY_OBJ.rotation.copy(t.rotation);
      DUMMY_OBJ.scale.copy(t.scale);
      DUMMY_OBJ.updateMatrix();
      mesh.setMatrixAt(i, DUMMY_OBJ.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [transforms]);

  if (!transforms || transforms.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, transforms.length]}
      frustumCulled={false}
      renderOrder={1} // Render after opaque objects
    />
  );
}
