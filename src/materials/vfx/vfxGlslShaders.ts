/** Shared GLSL shader strings for VFX dual-path factories (#387). */

export const RAINBOW_VERTEX = `
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

export const RAINBOW_FRAGMENT = `
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

export const POND_FOG_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const POND_FOG_FRAGMENT = `
  uniform float time;
  uniform float opacity;
  uniform vec3 tintColor;
  varying vec2 vUv;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 0.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }
  void main() {
    vec2 uv = vUv * 3.0;
    uv.x += time * 0.015;
    uv.y += sin(time * 0.07) * 0.3;
    float swirl = fbm(uv);
    float bank = smoothstep(0.35, 0.85, swirl);
    float edgeFade = smoothstep(0.5, 0.05, distance(vUv, vec2(0.5)));
    float alpha = bank * edgeFade * opacity;
    gl_FragColor = vec4(tintColor, alpha);
  }
`;

export const SPLASH_BOW_VERTEX = `
  uniform float time;
  varying vec2 vUv;
  varying float vNoise;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float noise = sin(pos.x * 2.0 + time * 2.0) * cos(pos.z * 1.5 + time * 1.5);
    pos.y += noise * 0.05;
    vNoise = noise;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const SPLASH_BOW_FRAGMENT = `
  varying float vNoise;
  void main() {
    float alpha = 0.5 + vNoise * 0.2;
    vec3 color = vec3(0.667, 0.867, 1.0);
    gl_FragColor = vec4(color, alpha * 0.6);
  }
`;

export const VFX_NOISE_HELPERS = `
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

export const SUN_SHAFT_MOTE_VERTEX = `
  uniform float time;
  uniform float flowSpeed;
  uniform float sunFacing;
  attribute float aHeight;
  attribute float aRadius;
  attribute float aPhase;
  attribute float aSpeed;
  varying float vTwinkle;
  void main() {
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

export const SUN_SHAFT_MOTE_FRAGMENT = `
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
