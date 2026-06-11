import * as THREE from 'three';

export const GOD_RAYS_VERTEX_SHADER = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const GOD_RAYS_FRAGMENT_SHADER = `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform vec2 sunScreenPosition;
  uniform vec3 sunColor;
  uniform float intensity;
  uniform float rayLength;
  uniform int samples;
  uniform float decay;
  uniform float exposure;
  uniform float density;
  uniform float wallOcclusion;
  uniform float time;
  
  varying vec2 vUv;
  
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
  }
  
  void main() {
    vec2 uv = vUv;
    vec2 delta = sunScreenPosition - uv;
    float dist = length(delta);
    if (dist < 0.0005) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec2 direction = normalize(delta);
    
    float currentDepth = texture2D(tDepth, uv).r;
    float illumination = 0.0;
    float sampleDist = rayLength / float(max(samples, 1));
    vec2 samplePos = uv;
    float sampleWeight = 1.0;
    
    for (int i = 0; i < 64; i++) {
      if (i >= samples) break;
      samplePos += direction * sampleDist;
      if (samplePos.x < 0.0 || samplePos.x > 1.0 || samplePos.y < 0.0 || samplePos.y > 1.0) break;
      
      vec4 sceneColor = texture2D(tDiffuse, samplePos);
      float luminance = dot(sceneColor.rgb, vec3(0.299, 0.587, 0.114));
      float sampleDepth = texture2D(tDepth, samplePos).r;
      float mistNoise = noise(samplePos * 8.0 + vec2(time * 0.02, -time * 0.01)) * 0.5 + 0.5;
      
      float depthDelta = abs(sampleDepth - currentDepth);
      float edgeAttenuation = 1.0 - smoothstep(0.008, 0.085, depthDelta) * wallOcclusion;
      float mistDensity = density * mistNoise * edgeAttenuation;
      
      illumination += luminance * sampleWeight * mistDensity;
      sampleWeight *= decay;
    }
    
    illumination *= exposure / float(max(samples, 1));
    illumination = clamp(illumination, 0.0, 1.0);
    float sunFade = smoothstep(1.0, 0.15, dist);
    vec3 rayColor = sunColor * illumination * intensity * sunFade;
    
    gl_FragColor = vec4(rayColor, illumination * intensity);
  }
`;

export const GOD_RAYS_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    sunScreenPosition: { value: new THREE.Vector2(0.5, 0.2) },
    sunColor: { value: new THREE.Color('#fff4e0') },
    intensity: { value: 0.6 },
    rayLength: { value: 0.4 },
    samples: { value: 16 },
    decay: { value: 0.95 },
    exposure: { value: 0.18 },
    density: { value: 0.96 },
    wallOcclusion: { value: 0.9 },
    time: { value: 0 },
  },
  vertexShader: GOD_RAYS_VERTEX_SHADER,
  fragmentShader: GOD_RAYS_FRAGMENT_SHADER,
};

export const getGodRaySunColor = (timeOfDay: number) => {
  const midday = Math.max(0, 1.0 - Math.abs(timeOfDay - 0.5) * 2.0);
  const goldenHour = THREE.MathUtils.smoothstep(timeOfDay, 0.65, 0.9);
  return new THREE.Color('#fff6e3').lerp(new THREE.Color('#ffcc88'), goldenHour * 0.8 + (1.0 - midday) * 0.15);
};

