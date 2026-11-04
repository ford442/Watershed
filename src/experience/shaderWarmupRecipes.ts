/**
 * shaderWarmupRecipes — one throwaway object per material variant the first
 * seconds of a run draw (#466 audit, Phase B). Built by the same factories the
 * scene uses, with the same feature flags, so each compiles the program the
 * live object will look up — three shares a program between every material
 * whose parameters match, so one warm instance covers every segment's copy.
 *
 * What makes a program differ (and therefore what a recipe must match): the
 * material class, GLSL source + defines (ShaderMaterial), `customProgramCacheKey`
 * (`extendRiverMaterial` keys on its flags), which texture slots are bound,
 * `vertexColors` + the colour attribute's item size, instancing, side,
 * transparency/fog flags. Uniform values never matter — so the textures here
 * are 1×1 stand-ins and the uniforms are defaults.
 *
 * A recipe that misses a variant costs one synchronous compile on first draw,
 * exactly as before. One that matches nothing costs a program that sits idle.
 */
import * as THREE from 'three';
import { WATER_LEVEL, WALL_WATERLINE_Y } from '../constants/game';
import { createRiverSurfaceMaterial } from '../materials/river/createRiverSurfaceMaterial';
import { createWaterMaterial } from '../materials/water/createWaterMaterial';
import { createWeatherParticleMaterial } from '../materials/weather/createWeatherParticleMaterial';
import { createSplashBowWaveMaterial } from '../materials/vfx/createVfxMaterials';
import { createRockSurfaceMaterial, createTreeSurfaceMaterial } from '../materials/foliage/createFoliageSurfaceMaterial';
import { WATER_FRAGMENT_GLSL, WATER_VERTEX_GLSL, waterGlslDefines } from '../components/flowingWaterGlsl';
import { WATER_SURFACE_LAYER } from '../rendering/renderLayers';
import type { MaterialBackend } from '../rendering/materialBackend';
import type { ShaderWarmupRecipe } from '../rendering/shaderWarmup';

/** A triangle with every attribute the canyon meshes carry (segmentMeshBuild.ts). */
function canyonGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1]), 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
  geometry.setAttribute('mossMask', new THREE.BufferAttribute(new Float32Array(3), 1));
  geometry.setAttribute('highWaterMask', new THREE.BufferAttribute(new Float32Array(3), 1));
  return geometry;
}

function texel(colorSpace: THREE.ColorSpace = THREE.NoColorSpace): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** TrackManager's rock material: every PBR slot bound, vertex colours, double-sided. */
function rockSource(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    map: texel(THREE.SRGBColorSpace),
    normalMap: texel(),
    roughnessMap: texel(),
    aoMap: texel(),
    roughness: 0.85,
    metalness: 0.05,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  material.displacementMap = texel();
  return material;
}

function quad(material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(canyonGeometry(), material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function instanced(material: THREE.Material, withColor: boolean): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, 1);
  if (withColor) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function points(material: THREE.Material): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;
  return object;
}

function water(backend: MaterialBackend, hasFlowMap: boolean): THREE.Mesh {
  const { material } = createWaterMaterial({
    backend,
    init: {
      flowSpeed: 1,
      waterColor: '#2a6f7a',
      deepColor: '#173d43',
      foamColor: '#ffffff',
      edgeHighlight: '#bfe8ff',
    },
    glsl: { vertexShader: WATER_VERTEX_GLSL, fragmentShader: WATER_FRAGMENT_GLSL, defines: waterGlslDefines(hasFlowMap) },
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material as THREE.Material);
  mesh.layers.set(WATER_SURFACE_LAYER);
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * The warm set: canyon floor + wall (river-extended rock), the river / rock /
 * tree extensions the first segments' props use, water with and without the
 * SWE flow map, weather (rain / snow / splash), the splash bow wave, and the
 * plain standard-material shapes most decorations and the runner's props
 * reduce to.
 */
export function shaderWarmupRecipes(backend: MaterialBackend): ShaderWarmupRecipe[] {
  return [
    {
      id: 'canyon-floor',
      build: () =>
        quad(
          createRiverSurfaceMaterial(backend, rockSource(), {
            waterLevel: WATER_LEVEL,
            enableMoss: false,
            enableTriplanar: false,
          }),
        ),
    },
    {
      id: 'canyon-wall',
      build: () =>
        quad(
          createRiverSurfaceMaterial(backend, rockSource(), {
            enableWetness: true,
            enableMoss: true,
            enableTriplanar: true,
            waterLevel: WALL_WATERLINE_Y,
          }),
        ),
    },
    {
      // Driftwood / pinecone: the river extension without moss, on instances.
      id: 'river-prop',
      build: () => instanced(createRiverSurfaceMaterial(backend, new THREE.MeshStandardMaterial(), { enableMoss: false }), false),
    },
    {
      // Obstacles/Rock: the segment's rock material, and the plain fallback, both instanced.
      id: 'rock-obstacle',
      build: () => [
        instanced(createRockSurfaceMaterial(backend, rockSource()), false),
        instanced(createRockSurfaceMaterial(backend, new THREE.MeshStandardMaterial({ roughness: 0.9 })), false),
      ],
    },
    {
      // Environment/Vegetation: vertex-coloured trees with the wind / SSS extension.
      id: 'tree',
      build: () =>
        instanced(createTreeSurfaceMaterial(backend, new THREE.MeshStandardMaterial({ vertexColors: true }), { waterLevel: WATER_LEVEL }), false),
    },
    { id: 'water', build: () => water(backend, false) },
    { id: 'water-flowmap', build: () => water(backend, true) },
    { id: 'weather-rain', build: () => points(createWeatherParticleMaterial(backend, { kind: 'rain' })) },
    { id: 'weather-snow', build: () => points(createWeatherParticleMaterial(backend, { kind: 'snow' })) },
    { id: 'weather-splash', build: () => points(createWeatherParticleMaterial(backend, { kind: 'splash' })) },
    { id: 'splash-bow-wave', build: () => quad(createSplashBowWaveMaterial(backend)) },
    {
      id: 'standard',
      build: () => [
        quad(new THREE.MeshStandardMaterial()),
        instanced(new THREE.MeshStandardMaterial(), false),
        instanced(new THREE.MeshStandardMaterial(), true),
        instanced(new THREE.MeshStandardMaterial({ transparent: true }), false),
        instanced(new THREE.MeshStandardMaterial({ flatShading: true }), false),
        // Far props that opt out of fog.
        quad(new THREE.MeshStandardMaterial({ fog: false })),
        instanced(new THREE.MeshStandardMaterial({ fog: false }), false),
      ],
    },
    {
      // Unlit: plain, back-faced domes, transparent cards, instanced.
      id: 'basic',
      build: () => [
        quad(new THREE.MeshBasicMaterial()),
        quad(new THREE.MeshBasicMaterial({ side: THREE.BackSide })),
        quad(new THREE.MeshBasicMaterial({ transparent: true })),
        quad(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })),
        instanced(new THREE.MeshBasicMaterial(), false),
        instanced(new THREE.MeshBasicMaterial({ transparent: true }), false),
      ],
    },
  ];
}
