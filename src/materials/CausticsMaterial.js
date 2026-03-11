/**
 * CausticsMaterial - Animated water caustic patterns
 * 
 * Projects animated caustic light patterns onto surfaces below water.
 * Uses dual-layer sine wave texture scrolling for realistic effect.
 */

import * as THREE from 'three';

const VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepth;
  
  uniform float waterLevel;
  
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vDepth = waterLevel - worldPos.y;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  uniform float time;
  uniform vec3 waterColor;
  uniform float causticsIntensity;
  uniform float causticsScale;
  uniform float causticsSpeed;
  uniform float waterLevel;
  uniform float maxDepth;
  uniform sampler2D causticsTexture;
  
  varying vec2 vUv;
  varying vec3 vWorldPos;
  varying float vDepth;
  
  // Simplex noise for pattern variation
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
    // Calculate UVs based on world position
    vec2 causticsUV = vWorldPos.xz * causticsScale;
    
    // Dual-layer scrolling with different speeds and directions
    vec2 scroll1 = vec2(
      causticsUV.x + time * causticsSpeed * 0.5,
      causticsUV.y + time * causticsSpeed * 0.3
    );
    vec2 scroll2 = vec2(
      causticsUV.x * 1.3 + time * causticsSpeed * 0.4 + 0.5,
      causticsUV.y * 0.8 - time * causticsSpeed * 0.2 + 0.3
    );
    
    // Sample caustic patterns
    float caustic1 = 0.0;
    float caustic2 = 0.0;
    
    // Use texture if available, otherwise generate procedurally
    #ifdef USE_CAUSTICS_TEXTURE
      caustic1 = texture2D(causticsTexture, scroll1).r;
      caustic2 = texture2D(causticsTexture, scroll2 * 0.7).r;
    #else
      // Procedural caustic approximation using sine waves
      float wave1 = sin(scroll1.x * 8.0) * sin(scroll1.y * 8.0);
      float wave2 = sin(scroll1.x * 13.0 + 1.5) * sin(scroll1.y * 11.0);
      caustic1 = pow((wave1 + wave2) * 0.5 + 0.5, 3.0);
      
      float wave3 = sin(scroll2.x * 10.0) * sin(scroll2.y * 9.0);
      float wave4 = sin(scroll2.x * 15.0) * sin(scroll2.y * 12.0);
      caustic2 = pow((wave3 + wave4) * 0.5 + 0.5, 2.5);
    #endif
    
    // Mix the two layers
    float causticPattern = mix(caustic1, caustic2, 0.5);
    
    // Add noise variation
    float noise = snoise(vWorldPos.xz * 0.5 + time * 0.1) * 0.3 + 0.7;
    causticPattern *= noise;
    
    // Depth attenuation (caustics fade with depth)
    float depthFactor = 1.0 - smoothstep(0.0, maxDepth, vDepth);
    
    // Sharpen caustic edges
    causticPattern = smoothstep(0.3, 0.9, causticPattern);
    
    // Final caustic color
    vec3 causticColor = waterColor * causticPattern * causticsIntensity * depthFactor;
    
    // Output with alpha for blending
    float alpha = causticPattern * causticsIntensity * depthFactor * 0.5;
    gl_FragColor = vec4(causticColor, alpha);
  }
`;

/**
 * Create caustics projection material
 */
export function createCausticsMaterial(options = {}) {
  const {
    waterColor = '#1a7b9c',
    causticsIntensity = 0.5,
    causticsScale = 0.1,
    causticsSpeed = 0.5,
    waterLevel = 0.5,
    maxDepth = 10.0,
    causticsTexture = null,
    time = 0,
  } = options;

  const defines = causticsTexture ? { USE_CAUSTICS_TEXTURE: '' } : {};

  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: time },
      waterColor: { value: new THREE.Color(waterColor) },
      causticsIntensity: { value: causticsIntensity },
      causticsScale: { value: causticsScale },
      causticsSpeed: { value: causticsSpeed },
      waterLevel: { value: waterLevel },
      maxDepth: { value: maxDepth },
      causticsTexture: { value: causticsTexture },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    defines,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/**
 * CausticsProjector - Component that projects caustics onto canyon floor
 */
export function createCausticsProjector(geometry, options = {}) {
  const material = createCausticsMaterial(options);
  
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 1; // Render after water, before opaque objects
  mesh.position.y += 0.05; // Slightly above floor to avoid z-fighting
  
  return { mesh, material };
}

/**
 * Update caustics material time uniform
 */
export function updateCausticsMaterial(material, elapsedTime) {
  if (material && material.uniforms) {
    material.uniforms.time.value = elapsedTime;
  }
}

export default createCausticsMaterial;
