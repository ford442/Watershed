/**
 * VolumetricGodRays - Ray-marching volumetric light shafts through mist
 * 
 * Implements screen-space ray marching for realistic god ray effects
 * that interact with scene mist density.
 */

import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useBiome } from '../BiomeSystem';

const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec3 sunPosition;
  uniform vec3 sunColor;
  uniform float intensity;
  uniform float rayLength;
  uniform int samples;
  uniform float decay;
  uniform float exposure;
  uniform float density;
  uniform vec2 resolution;
  uniform float time;
  
  varying vec2 vUv;
  
  // Noise for mist variation
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  
  void main() {
    vec2 uv = vUv;
    
    // Get sun position in screen space
    vec2 sunScreen = sunPosition.xy / sunPosition.z * 0.5 + 0.5;
    sunScreen.y = 1.0 - sunScreen.y; // Flip Y
    
    // Calculate ray direction from pixel to sun
    vec2 delta = sunScreen - uv;
    float dist = length(delta);
    vec2 direction = normalize(delta);
    
    // Early exit if sun is behind camera
    if (sunPosition.z < 0.0 || dist < 0.01) {
      gl_FragColor = vec4(0.0);
      return;
    }
    
    // Ray marching
    float illumination = 0.0;
    float sampleDist = rayLength / float(samples);
    vec2 samplePos = uv;
    float sampleWeight = 1.0;
    
    for (int i = 0; i < 64; i++) {
      if (i >= samples) break;
      
      samplePos += direction * sampleDist;
      
      // Check bounds
      if (samplePos.x < 0.0 || samplePos.x > 1.0 || 
          samplePos.y < 0.0 || samplePos.y > 1.0) break;
      
      // Sample scene color
      vec4 sceneColor = texture2D(tDiffuse, samplePos);
      
      // Add mist density variation
      float mistNoise = noise(samplePos * 3.0 + time * 0.1) * 0.5 + 0.5;
      float mistDensity = density * mistNoise;
      
      // Accumulate light (brighter areas contribute more)
      float luminance = dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114));
      illumination += luminance * sampleWeight * mistDensity;
      
      // Decay sample weight
      sampleWeight *= decay;
    }
    
    // Apply exposure
    illumination *= exposure / float(samples);
    illumination = clamp(illumination, 0.0, 1.0);
    
    // Fade based on distance from sun
    float sunFade = smoothstep(1.0, 0.2, dist);
    
    // Output god ray color
    vec3 rayColor = sunColor * illumination * intensity * sunFade;
    gl_FragColor = vec4(rayColor, illumination * intensity);
  }
`;

interface VolumetricGodRaysProps {
  intensity?: number;
  rayLength?: number;
  samples?: number;
  decay?: number;
  exposure?: number;
  sunColor?: string;
}

/**
 * VolumetricGodRays - Post-processing effect for light shafts
 */
export const VolumetricGodRays: React.FC<VolumetricGodRaysProps> = ({
  intensity = 0.8,
  rayLength = 0.5,
  samples = 32,
  decay = 0.95,
  exposure = 0.3,
  sunColor = '#fff4e0',
}) => {
  const { camera, scene, size } = useThree();
  const { currentBiome } = useBiome();
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  
  // Find sun in scene
  React.useEffect(() => {
    scene.traverse((obj) => {
      if (obj instanceof THREE.DirectionalLight && obj.intensity > 0.8) {
        sunRef.current = obj;
      }
    });
  }, [scene]);
  
  // Create render target for scene capture
  const renderTarget = useMemo(() => {
    return new THREE.WebGLRenderTarget(size.width, size.height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
  }, [size]);
  
  // Create shader material
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        sunPosition: { value: new THREE.Vector3() },
        sunColor: { value: new THREE.Color(sunColor) },
        intensity: { value: intensity * currentBiome.sunShaftIntensity },
        rayLength: { value: rayLength },
        samples: { value: samples },
        decay: { value: decay },
        exposure: { value: exposure },
        density: { value: currentBiome.mistDensity },
        resolution: { value: new THREE.Vector2(size.width, size.height) },
        time: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
  }, [sunColor, intensity, rayLength, samples, decay, exposure, currentBiome, size]);
  
  // Update uniforms each frame
  useFrame((state) => {
    if (!materialRef.current || !sunRef.current) return;
    
    const sun = sunRef.current;
    const mat = materialRef.current;
    
    // Calculate sun position in view space
    const sunPos = sun.position.clone();
    sunPos.project(camera);
    mat.uniforms.sunPosition.value.set(sunPos.x, sunPos.y, sunPos.z);
    
    // Update time for animation
    mat.uniforms.time.value = state.clock.elapsedTime;
    
    // Update biome-dependent values
    mat.uniforms.intensity.value = intensity * currentBiome.sunShaftIntensity;
    mat.uniforms.density.value = currentBiome.mistDensity;
  });
  
  return (
    <mesh material={material} ref={(mesh) => {
      if (mesh) materialRef.current = mesh.material as THREE.ShaderMaterial;
    }}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  );
};

export default VolumetricGodRays;
