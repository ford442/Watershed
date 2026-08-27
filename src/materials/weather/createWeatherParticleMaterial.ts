import * as THREE from 'three';
import type { MaterialBackend } from '../../rendering/materialBackend';
import { getLoadedNodeMaterials } from '../nodeMaterials';
import type { WeatherKind, WeatherParticleInit } from './WeatherNodeMaterial';

export const RAIN_VERTEX_SHADER = `
  uniform float time;
  uniform float fallSpeed;
  uniform float windX;
  uniform float windZ;
  uniform vec3 cameraPos;
  attribute float offset;
  attribute float speedVar;
  varying float vAlpha;

  void main() {
    vec3 pos = position;
    float fall = mod(time * fallSpeed * speedVar + offset, 1.0);
    pos.y = cameraPos.y + 15.0 - fall * 30.0;
    pos.x += fall * windX;
    pos.z += fall * windZ;
    float halfW = 25.0;
    float halfL = 30.0;
    pos.x = cameraPos.x + mod(pos.x - cameraPos.x + halfW, halfW * 2.0) - halfW;
    pos.z = cameraPos.z + mod(pos.z - cameraPos.z + halfL, halfL * 2.0) - halfL;
    float groundY = cameraPos.y - 10.0;
    vAlpha = smoothstep(groundY, groundY + 4.0, pos.y);
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = 2.5 * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const RAIN_FRAGMENT_SHADER = `
  varying float vAlpha;
  uniform float globalAlpha;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = abs(uv.x) * 0.15 + abs(uv.y) * 1.8;
    float a = 1.0 - smoothstep(0.0, 0.5, d);
    if (a < 0.05) discard;
    gl_FragColor = vec4(0.75, 0.8, 0.9, a * vAlpha * globalAlpha);
  }
`;

export const SNOW_FRAGMENT_SHADER = `
  varying float vAlpha;
  uniform float globalAlpha;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = 1.0 - smoothstep(0.2, 0.5, d);
    if (a < 0.05) discard;
    gl_FragColor = vec4(0.95, 0.98, 1.0, a * vAlpha * globalAlpha);
  }
`;

export const SPLASH_VERTEX_SHADER = `
  uniform float time;
  attribute float spawnTime;
  attribute vec3 origin;
  attribute float duration;
  attribute float size;
  varying float vAlpha;
  void main() {
    float age = time - spawnTime;
    float life = clamp(age / duration, 0.0, 1.0);
    vAlpha = 1.0 - life;
    vec3 pos = origin;
    pos.y += life * 0.4;
    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = size * (250.0 / -mvPosition.z) * (1.0 - life * 0.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const SPLASH_FRAGMENT_SHADER = `
  varying float vAlpha;
  uniform float globalAlpha;
  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    float d = length(uv);
    float a = 1.0 - smoothstep(0.0, 0.45, d);
    if (a < 0.05) discard;
    gl_FragColor = vec4(0.9, 0.95, 1.0, a * vAlpha * globalAlpha);
  }
`;

const warned = { current: false };

export function createWeatherParticleMaterial(
  backend: MaterialBackend,
  init: WeatherParticleInit,
): THREE.Material {
  const nodes = getLoadedNodeMaterials();
  if (backend === 'tsl' && nodes?.weather) {
    try {
      return nodes.weather.createWeatherParticleNodeMaterial(init) as unknown as THREE.Material;
    } catch (error) {
      if (!warned.current) {
        warned.current = true;
        console.warn('[createWeatherParticleMaterial] TSL failed; falling back to GLSL.', error);
      }
    }
  }

  const kind: WeatherKind = init.kind;
  const common = {
    time: { value: init.time ?? 0 },
    fallSpeed: { value: init.fallSpeed ?? 1 },
    windX: { value: init.windX ?? 0 },
    windZ: { value: init.windZ ?? 0 },
    cameraPos: { value: init.cameraPos?.clone() ?? new THREE.Vector3() },
    globalAlpha: { value: init.globalAlpha ?? 0 },
  };

  if (kind === 'splash') {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { time: common.time, globalAlpha: common.globalAlpha },
      vertexShader: SPLASH_VERTEX_SHADER,
      fragmentShader: SPLASH_FRAGMENT_SHADER,
    });
  }

  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: kind === 'snow' ? THREE.NormalBlending : THREE.AdditiveBlending,
    uniforms: common,
    vertexShader: RAIN_VERTEX_SHADER,
    fragmentShader: kind === 'snow' ? SNOW_FRAGMENT_SHADER : RAIN_FRAGMENT_SHADER,
  });
}

export function resetWeatherMaterialWarnings(): void {
  warned.current = false;
}
