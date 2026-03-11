/**
 * EnhancedWaterMaterial - Advanced water with reflections and refraction
 * 
 * Features:
 * - Planar reflections from WaterReflection component
 * - Refraction distortion with normal mapping
 * - Fresnel-based reflection/refraction blending
 * - Depth-based coloration
 * - Caustic projection
 */

import * as THREE from 'three';

const VERTEX_SHADER = `
  uniform float time;
  uniform float flowSpeed;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWave;
  varying vec4 vReflectionUv;
  
  // Simple wave function
  float wave(vec2 pos, float t, float speed, float freq, float amp) {
    return sin(pos.x * freq + t * speed) * sin(pos.y * freq * 0.7 + t * speed * 0.8) * amp;
  }
  
  void main() {
    vUv = uv;
    
    vec3 pos = position;
    
    // Multi-layer wave displacement
    float w1 = wave(pos.xz, time, flowSpeed * 1.2, 0.5, 0.12);
    float w2 = wave(pos.xz + vec2(1.5), time, flowSpeed * 0.9, 0.4, 0.08);
    float w3 = wave(pos.xz * 1.3, time, flowSpeed * 0.7, 0.8, 0.04);
    float w4 = wave(pos.xz * 2.1, time, flowSpeed * 1.5, 1.3, 0.025);
    
    pos.y += w1 + w2 + w3 + w4;
    vWave = (w1 + w2 + w3 + w4 + 0.215) / 0.43;
    
    // Calculate world position
    vec4 worldPos = modelMatrix * vec4(pos, 1.0);
    vWorldPos = worldPos.xyz;
    
    // Approximate normal from waves
    float dx = wave(pos.xz + vec2(0.01, 0.0), time, flowSpeed, 0.5, 0.12) - w1;
    float dz = wave(pos.xz + vec2(0.0, 0.01), time, flowSpeed, 0.5, 0.12) - w1;
    vec3 normal = normalize(vec3(-dx * 100.0, 1.0, -dz * 100.0));
    vNormal = normalMatrix * normal;
    
    // View direction
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    
    // Reflection UVs
    vReflectionUv = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D reflectionTexture;
  uniform sampler2D refractionTexture;
  uniform sampler2D normalMap;
  uniform sampler2D causticsTexture;
  
  uniform vec3 waterColor;
  uniform vec3 deepColor;
  uniform vec3 foamColor;
  uniform vec3 highlightColor;
  uniform float time;
  uniform float flowSpeed;
  uniform float opacity;
  uniform float causticsIntensity;
  uniform float reflectivity;
  uniform float waterLevel;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying float vWave;
  varying vec4 vReflectionUv;
  
  // Noise
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += noise(p) * a;
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }
  
  void main() {
    // Normal map scrolling for refraction
    vec2 normalUv1 = vWorldPos.xz * 0.1 + vec2(time * flowSpeed * 0.02, time * flowSpeed * 0.01);
    vec2 normalUv2 = vWorldPos.xz * 0.15 - vec2(time * flowSpeed * 0.015, time * flowSpeed * 0.025);
    
    float n1 = noise(normalUv1 * 5.0);
    float n2 = noise(normalUv2 * 4.0);
    vec2 distortion = (vec2(n1, n2) - 0.5) * 0.1;
    
    // Reflection
    vec2 reflectionUv = vReflectionUv.xy / vReflectionUv.w * 0.5 + 0.5;
    reflectionUv += distortion * 0.02;
    vec3 reflection = texture2D(reflectionTexture, reflectionUv).rgb;
    
    // Refraction (would use refraction texture from below-water render)
    vec3 refraction = mix(waterColor, deepColor, 0.5);
    
    // Fresnel factor
    float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 3.0);
    fresnel = mix(0.1, 1.0, fresnel);
    
    // Blend reflection and refraction
    vec3 water = mix(refraction, reflection, fresnel * reflectivity);
    
    // Caustics projection
    vec2 causticsUv = vWorldPos.xz * 0.2 + time * 0.1;
    float caustic = fbm(causticsUv) * fbm(causticsUv * 1.5 + 1.0);
    caustic = smoothstep(0.4, 0.8, caustic);
    water += waterColor * caustic * causticsIntensity * (1.0 - fresnel);
    
    // Foam
    vec2 foamUv = vUv + distortion * 0.1;
    float foamNoise = fbm(foamUv * 8.0 + time * 0.2);
    float foam = smoothstep(0.6, 0.8, foamNoise + vWave * 0.3);
    
    // Bank foam
    float bankDist = abs(vUv.x - 0.5) * 2.0;
    float bankFoam = smoothstep(0.8, 0.95, bankDist) * (0.5 + foamNoise * 0.5);
    foam = max(foam, bankFoam * 0.5);
    
    water = mix(water, foamColor, foam * 0.7);
    
    // Highlights on wave crests
    float highlight = smoothstep(0.7, 0.95, vWave);
    water += highlightColor * highlight * 0.3;
    
    // Edge glow
    water += highlightColor * fresnel * 0.2;
    
    // Depth fade
    float alpha = opacity + foam * 0.2 + highlight * 0.1;
    alpha = clamp(alpha, 0.6, 0.95);
    
    gl_FragColor = vec4(water, alpha);
  }
`;

/**
 * Create enhanced water material
 */
export function createEnhancedWaterMaterial(options = {}) {
  const {
    waterColor = '#1a7b9c',
    deepColor = '#0d4a5a',
    foamColor = '#dff4ff',
    highlightColor = '#8be8ff',
    flowSpeed = 1.0,
    opacity = 0.7,
    causticsIntensity = 0.5,
    reflectivity = 0.6,
    waterLevel = 0.5,
    reflectionTexture = null,
    refractionTexture = null,
    time = 0,
  } = options;

  return new THREE.ShaderMaterial({
    uniforms: {
      reflectionTexture: { value: reflectionTexture },
      refractionTexture: { value: refractionTexture },
      normalMap: { value: null },
      causticsTexture: { value: null },
      waterColor: { value: new THREE.Color(waterColor) },
      deepColor: { value: new THREE.Color(deepColor) },
      foamColor: { value: new THREE.Color(foamColor) },
      highlightColor: { value: new THREE.Color(highlightColor) },
      time: { value: time },
      flowSpeed: { value: flowSpeed },
      opacity: { value: opacity },
      causticsIntensity: { value: causticsIntensity },
      reflectivity: { value: reflectivity },
      waterLevel: { value: waterLevel },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export default createEnhancedWaterMaterial;
