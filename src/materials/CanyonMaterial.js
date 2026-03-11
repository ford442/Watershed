/**
 * CanyonMaterial - Multi-layered geological shader with parallax mapping
 * 
 * Implements:
 * - 5-layer geological strata (bedrock → sedimentary → granite → moss → soil)
 * - Weathering patterns (water streaks, moss coverage, cracks)
 * - Parallax mapping for depth
 * - Height-based roughness and metalness variation
 * - Biome-aware color adaptation
 */

import * as THREE from 'three';

// Geological layer definitions
const GEOLOGICAL_LAYERS = {
  bedrock: {
    color: new THREE.Color('#3d3530'),
    roughness: 0.85,
    metalness: 0.05,
    heightRange: [0, 0.5],
  },
  sedimentary: {
    color: new THREE.Color('#5c5048'),
    roughness: 0.75,
    metalness: 0.08,
    heightRange: [0.5, 0.7],
  },
  granite: {
    color: new THREE.Color('#7a7068'),
    roughness: 0.65,
    metalness: 0.12,
    heightRange: [0.7, 0.85],
  },
  moss: {
    color: new THREE.Color('#4a5a40'),
    roughness: 0.9,
    metalness: 0.02,
    heightRange: [0.85, 0.95],
  },
  soil: {
    color: new THREE.Color('#5a5040'),
    roughness: 0.95,
    metalness: 0.0,
    heightRange: [0.95, 1.0],
  },
};

// Biome color adaptations
const BIOME_ADAPTATIONS = {
  summer: {
    mossColor: new THREE.Color('#587248'),
    soilColor: new THREE.Color('#5a5040'),
    weatheringIntensity: 0.8,
  },
  autumn: {
    mossColor: new THREE.Color('#7a6640'),
    soilColor: new THREE.Color('#6a5848'),
    weatheringIntensity: 0.9,
  },
  alpine: {
    mossColor: new THREE.Color('#4a5a50'),
    soilColor: new THREE.Color('#505850'),
    weatheringIntensity: 0.6,
  },
  sunset: {
    mossColor: new THREE.Color('#6a5840'),
    soilColor: new THREE.Color('#705848'),
    weatheringIntensity: 0.85,
  },
  midnight: {
    mossColor: new THREE.Color('#3a4a40'),
    soilColor: new THREE.Color('#3a4038'),
    weatheringIntensity: 0.7,
  },
};

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying vec3 vViewDir;
  
  uniform float time;
  uniform float wallHeight;
  
  // Simplex noise for surface variation
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
  
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
      + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
      dot(x12.zw,x12.zw)), 0.0);
    m = m*m; m = m*m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }
  
  void main() {
    vUv = uv;
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vNormal = normalize(normalMatrix * normal);
    
    // Calculate height normalized to wall (0 = base, 1 = top)
    vHeight = (vWorldPos.y + 5.0) / wallHeight;
    
    // Add surface variation noise
    float surfaceNoise = snoise(vWorldPos.xz * 0.15) * 0.3 
                       + snoise(vWorldPos.xz * 0.5) * 0.1;
    vHeight += surfaceNoise * 0.05;
    vHeight = clamp(vHeight, 0.0, 1.0);
    
    // View direction for parallax
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying float vHeight;
  varying vec3 vViewDir;
  
  uniform float time;
  uniform vec3 bedrockColor;
  uniform vec3 sedimentaryColor;
  uniform vec3 graniteColor;
  uniform vec3 mossColor;
  uniform vec3 soilColor;
  uniform float roughness;
  uniform float metalness;
  uniform float weatheringIntensity;
  uniform vec3 sunDirection;
  uniform float parallaxScale;
  
  // Noise functions
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  
  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for(int i = 0; i < 4; i++) {
      value += noise(p) * amp;
      p *= 2.0;
      amp *= 0.5;
    }
    return value;
  }
  
  // Smooth step function for geological layers
  float smoothLayer(float h, float min1, float max1, float min2, float max2) {
    float inLayer1 = smoothstep(min1, max1, h);
    float inLayer2 = smoothstep(min2, max2, h);
    return inLayer1 * (1.0 - inLayer2);
  }
  
  // Weathering streaks (water channels)
  float weatheringStreaks(vec2 uv, float h) {
    float streaks = 0.0;
    float freq = 0.3;
    
    // Vertical water channels
    for(int i = 0; i < 3; i++) {
      float offset = float(i) * 10.0;
      float x = uv.x * freq + sin(uv.y * 0.5 + offset) * 0.3;
      float streak = smoothstep(0.6, 0.9, noise(vec2(x * 3.0, uv.y * 0.2)));
      streaks += streak * 0.3;
    }
    
    // Height-based intensity (more weathering lower down)
    streaks *= (1.0 - h) * weatheringIntensity;
    
    return streaks;
  }
  
  // Moss coverage (more on top, noise-based)
  float mossCoverage(float h, vec2 uv) {
    float baseCoverage = smoothstep(0.8, 0.95, h);
    float noiseVar = fbm(uv * 2.0 + time * 0.01) * 0.4 + 0.6;
    return baseCoverage * noiseVar * weatheringIntensity;
  }
  
  // Crack patterns for realism
  float crackPattern(vec2 uv) {
    float cracks = 0.0;
    float n = fbm(uv * 4.0);
    cracks = smoothstep(0.7, 0.75, n) * 0.3;
    return cracks;
  }
  
  void main() {
    // Parallax offset for depth
    vec2 parallaxOffset = vViewDir.xy * parallaxScale * (1.0 - dot(vNormal, vec3(0,1,0)));
    vec2 uv = vUv + parallaxOffset;
    
    float h = vHeight;
    
    // Geological layer blending
    vec3 color = bedrockColor;
    float layerMix = 0.0;
    
    // Layer 1: Bedrock (0-50%)
    layerMix = smoothstep(0.0, 0.5, h) - smoothstep(0.5, 0.7, h);
    color = mix(color, sedimentaryColor, layerMix);
    
    // Layer 2: Sedimentary (50-70%)
    layerMix = smoothstep(0.5, 0.7, h) - smoothstep(0.7, 0.85, h);
    color = mix(color, graniteColor, layerMix);
    
    // Layer 3: Granite (70-85%)
    layerMix = smoothstep(0.7, 0.85, h) - smoothstep(0.85, 0.95, h);
    
    // Layer 4: Moss (85-95%)
    float mossAmt = mossCoverage(h, uv);
    color = mix(color, mossColor, mossAmt * 0.7);
    
    // Layer 5: Soil (95-100%)
    layerMix = smoothstep(0.95, 1.0, h);
    color = mix(color, soilColor, layerMix);
    
    // Apply weathering streaks
    float streaks = weatheringStreaks(uv, h);
    color = mix(color, color * 0.7, streaks); // Darken where water runs
    
    // Apply crack patterns (darker in cracks)
    float cracks = crackPattern(uv);
    color = mix(color, color * 0.6, cracks);
    
    // Surface detail noise
    float detailNoise = fbm(uv * 8.0) * 0.1 - 0.05;
    color += detailNoise;
    
    // Height-based roughness variation
    float heightRoughness = mix(0.85, 0.45, h); // Smoother at top
    heightRoughness = mix(heightRoughness, 0.3, mossAmt); // Moss is rough
    
    // Metalness variation (minerals in cracks, wet patches)
    float heightMetalness = mix(0.05, 0.15, streaks + cracks * 0.5);
    
    // Rim lighting for visual appeal
    float rim = 1.0 - dot(vNormal, normalize(vViewDir));
    rim = smoothstep(0.4, 0.8, rim);
    vec3 rimColor = vec3(0.3, 0.25, 0.2) * rim * 0.3;
    color += rimColor;
    
    // Output
    gl_FragColor = vec4(color, 1.0);
    
    // Store material properties in additional buffers (if using MRT)
    // gl_FragData[1] = vec4(heightRoughness, heightMetalness, 0.0, 1.0);
  }
`;

/**
 * Create enhanced canyon material with geological layering
 */
export function createCanyonMaterial(options = {}) {
  const {
    biome = 'summer',
    wallHeight = 15,
    parallaxScale = 0.02,
    time = 0,
  } = options;

  const biomeAdapt = BIOME_ADAPTATIONS[biome] || BIOME_ADAPTATIONS.summer;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: time },
      wallHeight: { value: wallHeight },
      bedrockColor: { value: GEOLOGICAL_LAYERS.bedrock.color },
      sedimentaryColor: { value: GEOLOGICAL_LAYERS.sedimentary.color },
      graniteColor: { value: GEOLOGICAL_LAYERS.granite.color },
      mossColor: { value: biomeAdapt.mossColor },
      soilColor: { value: biomeAdapt.soilColor },
      roughness: { value: 0.75 },
      metalness: { value: 0.08 },
      weatheringIntensity: { value: biomeAdapt.weatheringIntensity },
      sunDirection: { value: new THREE.Vector3(0.5, 1, 0.3).normalize() },
      parallaxScale: { value: parallaxScale },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  return material;
}

/**
 * Create fallback MeshStandardMaterial for compatibility
 */
export function createFallbackCanyonMaterial(options = {}) {
  const { biome = 'summer' } = options;
  
  const baseColor = biome === 'autumn' 
    ? new THREE.Color('#9c7850') 
    : new THREE.Color('#888880');

  return new THREE.MeshStandardMaterial({
    color: baseColor,
    roughness: 0.8,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
}

/**
 * Update material uniforms (call in useFrame)
 */
export function updateCanyonMaterial(material, deltaTime, elapsedTime) {
  if (material && material.uniforms) {
    material.uniforms.time.value = elapsedTime;
  }
}

export default createCanyonMaterial;
