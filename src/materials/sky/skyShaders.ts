/** GLSL sources for sky clouds + stars (GLSL backend of createSkyMaterials). */

export const CLOUD_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const CLOUD_FRAGMENT = `
  uniform float time;
  uniform float opacity;
  uniform float sunsetBlend;
  uniform float overcastBlend;
  uniform vec3 cloudColorA;
  uniform vec3 cloudColorB;
  uniform vec3 sunDir2D;
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * noise(p);
      p *= 2.0;
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv * 2.8;
    uv.x += time * 0.003;
    uv.y += time * 0.0018;

    float n = fbm(uv);
    float cloud = smoothstep(0.52, 0.8, n);

    float nSun = fbm(uv + sunDir2D.xz * 0.18);
    float cloudSun = smoothstep(0.52, 0.8, nSun);
    float litFactor = clamp(0.5 + (cloud - cloudSun) * 1.6, 0.0, 1.0);

    vec3 cloudColor = mix(cloudColorA, cloudColorB, sunsetBlend);
    vec3 shadowColor = cloudColor * 0.55;
    vec3 highlightColor = mix(cloudColor, vec3(1.0, 0.98, 0.92), 0.55);
    vec3 litColor = mix(shadowColor, highlightColor, litFactor);

    litColor = mix(litColor, vec3(0.55, 0.57, 0.6), overcastBlend * 0.85);
    float cloudCoverage = mix(cloud, clamp(cloud + 0.35, 0.0, 1.0), overcastBlend);

    float alpha = cloudCoverage * opacity;
    gl_FragColor = vec4(litColor, alpha);
  }
`;

export const STAR_VERTEX = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  uniform float uTime;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vColor = color;
    float twinkle = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
    vTwinkle = twinkle;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * twinkle * (300.0 / -mvPosition.z);
  }
`;

export const STAR_FRAGMENT = `
  uniform float uOpacity;
  varying vec3 vColor;
  varying float vTwinkle;

  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float core = smoothstep(0.5, 0.0, d);
    if (core <= 0.001) discard;
    gl_FragColor = vec4(vColor, core * vTwinkle * uOpacity);
  }
`;

export const SKY_DOME_VERTEX = `
  varying vec3 vWorldPos;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPos = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const SKY_DOME_FRAGMENT = `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  varying vec3 vWorldPos;

  void main() {
    vec3 dir = normalize(vWorldPos);
    float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(horizonColor, zenithColor, h);
    float sun = pow(max(dot(dir, normalize(sunDir)), 0.0), 32.0);
    col += sunColor * sun * 0.65;
    gl_FragColor = vec4(col, 1.0);
  }
`;
