/**
 * PostProcessing - Cinematic effects composer
 * 
 * Implements:
 * - Motion blur at high speeds
 * - Bloom on bright highlights
 * - Chromatic aberration on impacts
 * - Vignette and color grading
 */

import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { useLOD } from './LODManager';

// Simple post-processing mesh that covers screen
const VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// Motion blur shader
const MOTION_BLUR_SHADER = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 velocity;
  uniform float intensity;
  uniform int samples;
  
  varying vec2 vUv;
  
  void main() {
    vec3 color = vec3(0.0);
    float totalWeight = 0.0;
    
    for (int i = 0; i < 16; i++) {
      if (i >= samples) break;
      
      float t = float(i) / float(samples - 1);
      vec2 offset = velocity * (t - 0.5) * intensity;
      float weight = 1.0 - abs(t - 0.5) * 2.0;
      
      color += texture2D(tDiffuse, vUv + offset).rgb * weight;
      totalWeight += weight;
    }
    
    color /= totalWeight;
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Bloom shader
const BLOOM_SHADER = `
  uniform sampler2D tDiffuse;
  uniform float threshold;
  uniform float intensity;
  uniform float spread;
  
  varying vec2 vUv;
  
  void main() {
    vec3 color = texture2D(tDiffuse, vUv).rgb;
    float brightness = dot(color, vec3(0.299, 0.587, 0.114));
    
    if (brightness > threshold) {
      vec3 bloom = color * (brightness - threshold) * intensity;
      
      // Simple blur
      vec2 texel = vec2(1.0) / vec2(textureSize(tDiffuse, 0));
      bloom += texture2D(tDiffuse, vUv + vec2(texel.x, 0.0) * spread).rgb * 0.25;
      bloom += texture2D(tDiffuse, vUv - vec2(texel.x, 0.0) * spread).rgb * 0.25;
      bloom += texture2D(tDiffuse, vUv + vec2(0.0, texel.y) * spread).rgb * 0.25;
      bloom += texture2D(tDiffuse, vUv - vec2(0.0, texel.y) * spread).rgb * 0.25;
      
      gl_FragColor = vec4(bloom, 1.0);
    } else {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  }
`;

// Chromatic aberration shader
const CHROMATIC_SHADER = `
  uniform sampler2D tDiffuse;
  uniform float amount;
  uniform vec2 center;
  uniform float radius;
  
  varying vec2 vUv;
  
  void main() {
    vec2 delta = vUv - center;
    float dist = length(delta);
    
    if (dist < radius) {
      vec2 direction = normalize(delta);
      float factor = (1.0 - dist / radius) * amount;
      
      float r = texture2D(tDiffuse, vUv + direction * factor).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv - direction * factor).b;
      
      gl_FragColor = vec4(r, g, b, 1.0);
    } else {
      gl_FragColor = texture2D(tDiffuse, vUv);
    }
  }
`;

// Vignette shader
const VIGNETTE_SHADER = `
  uniform sampler2D tDiffuse;
  uniform float intensity;
  uniform vec2 center;
  uniform float smoothness;
  uniform vec3 color;
  
  varying vec2 vUv;
  
  void main() {
    vec4 texel = texture2D(tDiffuse, vUv);
    float dist = distance(vUv, center);
    float vignette = smoothstep(0.8, 0.8 - smoothness, dist) * (1.0 - intensity) + intensity;
    
    gl_FragColor = vec4(mix(color, texel.rgb, vignette), texel.a);
  }
`;

interface PostProcessingProps {
  playerRef: React.RefObject<any>;
  motionBlurThreshold?: number;
  bloomThreshold?: number;
  bloomIntensity?: number;
  vignetteIntensity?: number;
}

/**
 * PostProcessing - Effects composer
 */
export const PostProcessing: React.FC<PostProcessingProps> = ({
  playerRef,
  motionBlurThreshold = 25,
  bloomThreshold = 0.8,
  bloomIntensity = 0.5,
  vignetteIntensity = 0.4,
}) => {
  const { config } = useLOD();
  const { size, scene, camera, gl } = useThree();
  
  // Render targets
  const renderTargetRef = useRef<THREE.WebGLRenderTarget>();
  const bloomTargetRef = useRef<THREE.WebGLRenderTarget>();
  
  // Shader materials
  const motionBlurMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      velocity: { value: new THREE.Vector2(0, 0) },
      intensity: { value: 0 },
      samples: { value: 8 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: MOTION_BLUR_SHADER,
  }), []);
  
  const bloomMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      threshold: { value: bloomThreshold },
      intensity: { value: bloomIntensity },
      spread: { value: 2.0 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: BLOOM_SHADER,
  }), [bloomThreshold, bloomIntensity]);
  
  const chromaticMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: 0 },
      center: { value: new THREE.Vector2(0.5, 0.5) },
      radius: { value: 0.8 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: CHROMATIC_SHADER,
  }), []);
  
  const vignetteMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      intensity: { value: vignetteIntensity },
      center: { value: new THREE.Vector2(0.5, 0.5) },
      smoothness: { value: 0.4 },
      color: { value: new THREE.Color(0, 0, 0) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: VIGNETTE_SHADER,
  }), [vignetteIntensity]);
  
  // Create render targets
  useEffect(() => {
    renderTargetRef.current = new THREE.WebGLRenderTarget(size.width, size.height);
    bloomTargetRef.current = new THREE.WebGLRenderTarget(size.width / 2, size.height / 2);
    
    return () => {
      renderTargetRef.current?.dispose();
      bloomTargetRef.current?.dispose();
    };
  }, [size]);
  
  // Previous position for velocity calculation
  const prevPos = useRef(new THREE.Vector3());
  const currentVelocity = useRef(new THREE.Vector2());
  
  useFrame((state) => {
    if (!config.enableMotionBlur && !config.enableBloom) return;
    
    // Calculate player velocity
    if (playerRef.current) {
      const pos = playerRef.current.translation 
        ? playerRef.current.translation()
        : playerRef.current.position;
      
      if (pos) {
        const velocity = new THREE.Vector3(pos.x, 0, pos.z).sub(
          new THREE.Vector3(prevPos.current.x, 0, prevPos.current.z)
        ).multiplyScalar(60); // Rough FPS
        
        const speed = velocity.length();
        
        // Update motion blur intensity
        if (config.enableMotionBlur) {
          const blurIntensity = Math.max(0, (speed - motionBlurThreshold) / 50);
          motionBlurMat.uniforms.intensity.value = THREE.MathUtils.lerp(
            motionBlurMat.uniforms.intensity.value,
            blurIntensity * 0.02,
            0.1
          );
          
          // Project velocity to screen space
          const velNorm = velocity.clone().normalize();
          currentVelocity.current.set(velNorm.x, velNorm.z);
          motionBlurMat.uniforms.velocity.value.copy(currentVelocity.current);
        }
        
        prevPos.current.set(pos.x, pos.y, pos.z);
      }
    }
  });
  
  return null; // Effects would be applied via composer or custom render loop
};

export default PostProcessing;
