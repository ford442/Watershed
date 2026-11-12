/**
 * hostParity — one deterministic frame per dual material host, through both
 * backends (#555 Phase A.2).
 *
 * Every entry of `scripts/glsl-hosts-allowlist.json` is a *dual*: a GLSL factory
 * for `THREE.WebGLRenderer` and a TSL twin for the node renderer. Nothing has
 * ever compared the two, so a look change made on one side only drifts silently.
 * Each scene here builds a small fixed lit set with the host's own factory —
 * called once with `'glsl'` and once with `'tsl'`, exactly as the scene calls it —
 * and renders it on the renderer pair of `parityFrame.ts`. The frames go back to
 * `verification/post_parity.mjs`, which pixelmatches them and fails a scene whose
 * mismatched-pixel share exceeds its `maxMismatch`.
 *
 * `maxMismatch` is a ratchet, not a statement that the twins match: each one was
 * set just above what SwiftShader measured when the scene landed (the measured
 * value is in the comment). Lower it when a twin is brought closer; never raise
 * it to get a look change through — fix the other backend instead. Phase D of
 * #555 deletes the GLSL half, and these scenes are what say it is safe to.
 *
 * Coverage is enforced: `scripts/check-glsl-hosts.mjs` fails when a dual host in
 * the allowlist is not named in some scene's `hosts`.
 */
import * as THREE from 'three';
import type { MaterialBackend } from '../rendering/materialBackend';
import { loadNodeMaterials } from '../materials/nodeMaterials';
import { materialUniformBag } from '../materials/dual/materialUniformBag';
import { createCanyonSurfaceMaterial, updateCanyonSurfaceMaterial } from '../materials/canyon/createCanyonSurfaceMaterial';
import { createRiverSurfaceMaterial, updateRiverSurfaceMaterial } from '../materials/river/createRiverSurfaceMaterial';
import {
  createRockSurfaceMaterial,
  createTreeSurfaceMaterial,
  createVegetationSurfaceMaterial,
  updateTreeSurfaceMaterial,
  updateVegetationSurfaceMaterial,
} from '../materials/foliage/createFoliageSurfaceMaterial';
import { createWaterMaterial } from '../materials/water/createWaterMaterial';
import {
  createCloudMaterial,
  createMoonMaterial,
  createSkyDomeMaterial,
  createStarMaterial,
} from '../materials/sky/createSkyMaterials';
import { createWeatherParticleMaterial } from '../materials/weather/createWeatherParticleMaterial';
import {
  createMistMaterial,
  createRainbowMaterial,
  createSplashBowWaveMaterial,
  createWaterfallSheetMaterial,
} from '../materials/vfx/createVfxMaterials';
import {
  createDragonflyBodyMaterial,
  createFishBodyMaterial,
  createFishRingMaterial,
  updateCritterMaterialTime,
} from '../materials/critters/createCritterMaterials';
import { WATER_FRAGMENT_GLSL, WATER_VERTEX_GLSL, waterGlslDefines } from '../components/flowingWaterGlsl';
import { WATER_LEVEL, WALL_WATERLINE_Y } from '../constants/game';
import { WEATHER_CONFIG } from '../constants/weather';
import { createRng } from '../math/random';
import {
  FrameReadback,
  PARITY_HEIGHT,
  PARITY_WIDTH,
  createGlslParityRenderer,
  createNodeParityRenderer,
  settle,
} from './parityFrame';

/** Sim time every scene is drawn at: far enough in that animated terms move. */
const PARITY_TIME = 2.0;

interface BuiltHostScene {
  objects: THREE.Object3D[];
  /** Drive time-dependent uniforms through the hosts' own update calls. */
  update?(time: number): void;
}

export interface HostParityScene {
  name: string;
  /** Allowlist paths this scene exercises (scripts/glsl-hosts-allowlist.json). */
  hosts: readonly string[];
  /** Largest pixelmatch-flagged share of the frame (threshold 0.15) that passes. */
  maxMismatch: number;
  camera: { position: [number, number, number]; target: [number, number, number]; fov?: number };
  background?: THREE.ColorRepresentation;
  build(backend: MaterialBackend): BuiltHostScene;
}

export interface HostParityResult {
  scene: string;
  hosts: readonly string[];
  maxMismatch: number;
  /**
   * Materials the TSL draw built that are GLSL underneath (a ShaderMaterial, or an
   * `onBeforeCompile` hook the node renderer ignores): a twin that failed to build
   * and fell back. Any entry fails the scene — its frame says nothing about the twin.
   */
  tslFallbacks: string[];
  glslLuma: number;
  nodeLuma: number;
  glslPng: string;
  nodePng: string;
}

// ---------------------------------------------------------------------------
// Fixtures: geometry with every attribute the hosts read, deterministic textures
// ---------------------------------------------------------------------------

/** 64×64 mottled rock albedo from the project PRNG — a stand-in for Rock031. */
function rockAlbedo(): THREE.DataTexture {
  const size = 64;
  const rng = createRng(0x5eed);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const x = i % size;
    const y = Math.floor(i / size);
    const v = 0.55 + 0.25 * Math.sin(x * 0.4) * Math.cos(y * 0.3) + 0.2 * rng();
    data[i * 4] = Math.min(255, 150 * v);
    data[i * 4 + 1] = Math.min(255, 128 * v);
    data[i * 4 + 2] = Math.min(255, 104 * v);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A half-pipe channel along −Z (the canyon floor rising into both walls), with
 * the attributes `segmentMeshBuild.ts` gives canyon meshes: uv, uv2, colour
 * bands (dark waterline, tan rim), mossMask at the waterline, highWaterMask
 * just above it.
 */
function channelGeometry(radius = 7, length = 30): THREE.BufferGeometry {
  const geometry = new THREE.PlaneGeometry(1, 1, 64, 48);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const n = pos.count;
  const color = new Float32Array(n * 3);
  const mossMask = new Float32Array(n);
  const highWaterMask = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    const theta = (u - 0.5) * 2.4;
    const bump = 0.25 * Math.sin(u * 37) * Math.cos(v * 23);
    const r = radius + bump;
    const x = Math.sin(theta) * r;
    const y = (1 - Math.cos(theta)) * r - 0.2;
    pos.setXYZ(i, x, y, -v * length + 4);
    const h = THREE.MathUtils.clamp(y / (radius * 0.9), 0, 1);
    color[i * 3] = 0.7 + 0.3 * h;
    color[i * 3 + 1] = 0.66 + 0.28 * h;
    color[i * 3 + 2] = 0.6 + 0.22 * h;
    mossMask[i] = Math.max(0, 1 - Math.abs(y - 1.2) / 1.2);
    highWaterMask[i] = Math.max(0, 1 - Math.abs(y - 2.4) / 0.8);
  }
  geometry.setAttribute('uv2', uv.clone());
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setAttribute('mossMask', new THREE.BufferAttribute(mossMask, 1));
  geometry.setAttribute('highWaterMask', new THREE.BufferAttribute(highWaterMask, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** A conifer cone with TreeShader's attributes (wind weight up the trunk, foliage flags). */
function treeGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.ConeGeometry(1.1, 3.2, 14, 8);
  geometry.translate(0, 2.1, 0);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const windFactor = new Float32Array(n);
  const isFoliage = new Float32Array(n).fill(1);
  const isFoliageCard = new Float32Array(n);
  const leafSeed = new Float32Array(n);
  const color = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    const y = pos.getY(i);
    windFactor[i] = THREE.MathUtils.clamp((y - 0.5) / 3.2, 0, 1);
    leafSeed[i] = (i * 0.618) % 1;
    color[i * 3] = 0.22;
    color[i * 3 + 1] = 0.42 + 0.1 * windFactor[i];
    color[i * 3 + 2] = 0.2;
  }
  geometry.setAttribute('windFactor', new THREE.BufferAttribute(windFactor, 1));
  geometry.setAttribute('isFoliage', new THREE.BufferAttribute(isFoliage, 1));
  geometry.setAttribute('isFoliageCard', new THREE.BufferAttribute(isFoliageCard, 1));
  geometry.setAttribute('leafSeed', new THREE.BufferAttribute(leafSeed, 1));
  geometry.setAttribute('cardUv', (geometry.attributes.uv as THREE.BufferAttribute).clone());
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return geometry;
}

function points(count: number, place: (i: number, rng: () => number) => [number, number, number], attrs: Record<string, (i: number, rng: () => number) => number>): THREE.BufferGeometry {
  const rng = createRng(count * 7919);
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) position.set(place(i, rng), i * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  for (const [name, fn] of Object.entries(attrs)) {
    const values = new Float32Array(count);
    for (let i = 0; i < count; i += 1) values[i] = fn(i, rng);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, 1));
  }
  return geometry;
}

function instancedGrid(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  cells: Array<{ position: [number, number, number]; rotationY?: number; scale?: number }>,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, cells.length);
  const matrix = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  cells.forEach((cell, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), cell.rotationY ?? 0);
    const s = cell.scale ?? 1;
    matrix.compose(new THREE.Vector3(...cell.position), q, new THREE.Vector3(s, s, s));
    mesh.setMatrixAt(i, matrix);
  });
  mesh.frustumCulled = false;
  return mesh;
}

function instanceAttribute(mesh: THREE.InstancedMesh, name: string, values: number[]): void {
  mesh.geometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(values), 1));
}

/** Ground for the subjects to sit on: a plain standard material, which both renderers draw alike. */
function bed(color: THREE.ColorRepresentation = 0x4f5a44): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color, roughness: 0.95 }));
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function setUniform(material: THREE.Material, name: string, value: number): void {
  const slot = materialUniformBag(material)?.[name];
  if (slot) slot.value = value;
}

// ---------------------------------------------------------------------------
// Scenes — one or more per allowlist host
// ---------------------------------------------------------------------------

export const HOST_PARITY_SCENES: HostParityScene[] = [
  {
    name: 'canyon wall',
    hosts: ['src/materials/CanyonMaterial.ts'],
    // SwiftShader at landing: 0.00%.
    maxMismatch: 0.005,
    camera: { position: [0, 3.2, 6], target: [0, 2.2, -10] },
    build(backend) {
      const material = createCanyonSurfaceMaterial(backend, { biome: 'slotCanyon', wallHeight: 12 });
      return {
        objects: [new THREE.Mesh(channelGeometry(), material)],
        update: (t) => updateCanyonSurfaceMaterial(material, { flowSpeed: 1.2 }, t),
      };
    },
  },
  {
    name: 'river bank',
    hosts: ['src/utils/RiverShader.ts'],
    // SwiftShader at landing: 0.00%.
    maxMismatch: 0.005,
    camera: { position: [0, 3.2, 6], target: [0, 1.6, -10] },
    build(backend) {
      const map = rockAlbedo();
      map.repeat.set(4, 8);
      const material = createRiverSurfaceMaterial(
        backend,
        new THREE.MeshStandardMaterial({ map, roughness: 0.85, metalness: 0.05, vertexColors: true, side: THREE.DoubleSide }),
        { enableWetness: true, enableMoss: true, enableTriplanar: true, waterLevel: WALL_WATERLINE_Y },
      );
      return {
        objects: [new THREE.Mesh(channelGeometry(), material)],
        update: (t) => updateRiverSurfaceMaterial(material, t, { waterLevel: WALL_WATERLINE_Y, weatherWetness: 0.3 }),
      };
    },
  },
  {
    name: 'rocks',
    hosts: ['src/utils/RockShader.ts'],
    // SwiftShader at landing: 13.79% — the TSL rock twin drops the albedo map.
    maxMismatch: 0.155,
    camera: { position: [0, 2.6, 6], target: [0, 0.6, 0] },
    build(backend) {
      const material = createRockSurfaceMaterial(
        backend,
        new THREE.MeshStandardMaterial({ map: rockAlbedo(), roughness: 0.9, metalness: 0.02 }),
        { waterLevel: WATER_LEVEL },
      );
      const rocks = instancedGrid(new THREE.IcosahedronGeometry(1, 3), material, [
        { position: [-2.4, 0.6, 0], rotationY: 0.3, scale: 1.1 },
        { position: [0, 0.9, -1], rotationY: 1.2, scale: 1.4 },
        { position: [2.3, 0.5, 0.4], rotationY: 2.1, scale: 0.9 },
      ]);
      return { objects: [bed(), rocks] };
    },
  },
  {
    name: 'trees',
    hosts: ['src/utils/TreeShader.ts'],
    // SwiftShader at landing: 0.51%.
    maxMismatch: 0.01,
    camera: { position: [0, 3, 8], target: [0, 2, 0] },
    build(backend) {
      const material = createTreeSurfaceMaterial(
        backend,
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }),
        { waterLevel: WATER_LEVEL },
      );
      const trees = instancedGrid(treeGeometry(), material, [
        { position: [-2.8, 0, -1] },
        { position: [0, 0, -2], scale: 1.25 },
        { position: [2.6, 0, -0.5], scale: 0.9 },
      ]);
      return { objects: [bed(), trees], update: (t) => updateTreeSurfaceMaterial(material, t) };
    },
  },
  {
    name: 'vegetation',
    hosts: ['src/utils/VegetationShader.ts'],
    // SwiftShader at landing: 2.11%.
    maxMismatch: 0.03,
    camera: { position: [0, 1.4, 3.2], target: [0, 0.3, 0] },
    build(backend) {
      const material = createVegetationSurfaceMaterial(
        backend,
        new THREE.MeshStandardMaterial({ color: 0x6f9a3a, roughness: 0.85, side: THREE.DoubleSide }),
        { plantHeight: 0.65, windStrength: 0.05, windSpeed: 1.3 },
      );
      const blade = new THREE.PlaneGeometry(0.08, 0.65, 1, 4);
      blade.translate(0, 0.325, 0);
      const rng = createRng(17);
      const cells = Array.from({ length: 160 }, () => ({
        position: [(rng() - 0.5) * 4, 0, (rng() - 0.5) * 2.5] as [number, number, number],
        rotationY: rng() * Math.PI,
        scale: 0.7 + rng() * 0.6,
      }));
      return {
        objects: [bed(), instancedGrid(blade, material, cells)],
        update: (t) => updateVegetationSurfaceMaterial(material, t, 1),
      };
    },
  },
  {
    name: 'water',
    hosts: ['src/materials/water/createWaterMaterial.ts'],
    // SwiftShader at landing: 0.00%.
    maxMismatch: 0.005,
    camera: { position: [0, 3.5, 7], target: [0, 0.5, -6] },
    background: 0x8fb4d6,
    build(backend) {
      const handle = createWaterMaterial({
        backend,
        init: {
          flowSpeed: 1.2,
          waterColor: '#2a6f7a',
          deepColor: '#173d43',
          foamColor: '#ffffff',
          edgeHighlight: '#bfe8ff',
          sunWorldPosition: new THREE.Vector3(40, 60, -80),
        },
        glsl: { vertexShader: WATER_VERTEX_GLSL, fragmentShader: WATER_FRAGMENT_GLSL, defines: waterGlslDefines(false) },
      });
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(16, 30, 64, 96), handle.material as THREE.Material);
      surface.rotation.x = -Math.PI / 2;
      surface.position.set(0, WATER_LEVEL, -8);
      return {
        objects: [bed(0x3a3428), surface],
        update: (t) => {
          handle.uniforms.time.value = t;
        },
      };
    },
  },
  {
    name: 'sky',
    hosts: ['src/materials/sky/createSkyMaterials.ts'],
    // SwiftShader at landing: 1.55% — TSL stars draw no points.
    maxMismatch: 0.025,
    camera: { position: [0, 1, 0], target: [0.6, 1.25, -1], fov: 70 },
    build(backend) {
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(80, 32, 16),
        createSkyDomeMaterial(backend, {
          zenithColor: new THREE.Color('#4a7ab5'),
          horizonColor: new THREE.Color('#c8d8e8'),
          sunColor: new THREE.Color('#fff4d2'),
          sunDir: new THREE.Vector3(0.6, 0.35, -1).normalize(),
        }),
      );
      const cloudMaterial = createCloudMaterial(backend, {
        opacity: 0.6,
        sunsetBlend: 0.2,
        overcastBlend: 0.1,
        cloudColorA: new THREE.Color('#fff2e2'),
        cloudColorB: new THREE.Color('#ffcc88'),
        sunDir2D: new THREE.Vector3(0.3, 0, 0.3),
      });
      const clouds = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), cloudMaterial);
      clouds.rotation.x = Math.PI / 2;
      clouds.position.y = 30;
      const starMaterial = createStarMaterial(backend, { uOpacity: 0.8 });
      const stars = new THREE.Points(
        points(
          600,
          (_, rng) => {
            const a = rng() * Math.PI * 2;
            const e = 0.15 + rng() * 1.2;
            return [Math.cos(a) * Math.cos(e) * 70, Math.sin(e) * 70, Math.sin(a) * Math.cos(e) * 70];
          },
          { aSize: (_, rng) => 1 + rng() * 2.5, aPhase: (_, rng) => rng() * 6.28, aSpeed: (_, rng) => 0.5 + rng() },
        ),
        starMaterial,
      );
      const starColors = new Float32Array(600 * 3).fill(1);
      stars.geometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
      stars.frustumCulled = false;
      const moonMaterial = createMoonMaterial(backend, 0.35);
      moonMaterial.opacity = 1;
      const moon = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 16), moonMaterial);
      moon.position.set(14, 16, -40);
      return {
        objects: [dome, clouds, stars, moon],
        update: (t) => {
          setUniform(cloudMaterial, 'time', t);
          setUniform(starMaterial, 'uTime', t);
        },
      };
    },
  },
  {
    // WeatherSystem's three layers, laid out as it lays them (WEATHER_CONFIG spans,
    // splashes alive mid-life at PARITY_TIME).
    name: 'weather',
    hosts: ['src/materials/weather/createWeatherParticleMaterial.ts'],
    // SwiftShader at landing: 61.06% — the TSL twin has no size attenuation or camera wrap: no visible particles.
    maxMismatch: 0.66,
    camera: { position: [0, 2, 6], target: [0, 1.5, -6] },
    background: 0x40505e,
    build(backend) {
      const cameraPos = new THREE.Vector3(0, 2, 6);
      const { rain: rainCfg, snow: snowCfg } = WEATHER_CONFIG;
      type LayerSpan = Pick<typeof rainCfg, 'fallSpeed' | 'windX' | 'windZ' | 'spawnWidth' | 'spawnHeight' | 'spawnLength'>;
      const layer = (kind: 'rain' | 'snow', cfg: { [K in keyof LayerSpan]: number }, count: number) => {
        const material = createWeatherParticleMaterial(backend, {
          kind,
          fallSpeed: cfg.fallSpeed,
          windX: cfg.windX,
          windZ: cfg.windZ,
          cameraPos,
          globalAlpha: 0.6,
        });
        const geometry = points(
          count,
          (_, rng) => [(rng() - 0.5) * cfg.spawnWidth, rng() * cfg.spawnHeight, (rng() - 0.5) * cfg.spawnLength],
          { offset: (_, rng) => rng() * 100, speedVar: (_, rng) => 0.8 + rng() * 0.4 },
        );
        const object = new THREE.Points(geometry, material);
        object.frustumCulled = false;
        return object;
      };
      // A tenth of the live counts: at full density the GLSL rain saturates the frame.
      const rain = layer('rain', rainCfg, 300);
      const snow = layer('snow', snowCfg, 150);

      const splashMaterial = createWeatherParticleMaterial(backend, { kind: 'splash', globalAlpha: 1 });
      const splashGeometry = points(
        200,
        (_, rng) => [(rng() - 0.5) * 10, WATER_LEVEL, -rng() * 12],
        {
          spawnTime: (_, rng) => PARITY_TIME - rng() * 0.25,
          duration: (_, rng) => 0.3 + rng() * 0.3,
          size: (_, rng) => 1.5 + rng() * 2.5,
        },
      );
      splashGeometry.setAttribute('origin', (splashGeometry.attributes.position as THREE.BufferAttribute).clone());
      const splash = new THREE.Points(splashGeometry, splashMaterial);
      splash.frustumCulled = false;

      const materials = [rain.material, snow.material, splashMaterial] as THREE.Material[];
      return {
        objects: [bed(0x2e3a40), rain, snow, splash],
        update: (t) => {
          for (const material of materials) setUniform(material, 'time', t);
        },
      };
    },
  },
  {
    name: 'critters',
    hosts: ['src/materials/critters/createCritterMaterials.ts'],
    // SwiftShader at landing: 0.24%.
    maxMismatch: 0.01,
    camera: { position: [0, 2.2, 3.5], target: [0, 0.6, 0] },
    build(backend) {
      const body = new THREE.BoxGeometry(0.9, 0.06, 0.12, 8, 1, 1);
      const bodyPos = body.attributes.position as THREE.BufferAttribute;
      const hinge = new Float32Array(bodyPos.count * 3);
      const flap = new Float32Array(bodyPos.count);
      for (let i = 0; i < bodyPos.count; i += 1) {
        const x = bodyPos.getX(i);
        flap[i] = Math.abs(x) > 0.1 ? Math.sign(x) : 0;
        hinge[i * 3] = Math.sign(x) * 0.1;
      }
      body.setAttribute('aHinge', new THREE.BufferAttribute(hinge, 3));
      body.setAttribute('aFlap', new THREE.BufferAttribute(flap, 1));
      const dragonflyMaterial = createDragonflyBodyMaterial(backend, new THREE.MeshStandardMaterial({ color: 0x2f8fb0, roughness: 0.4, metalness: 0.3 }));
      const dragonflies = instancedGrid(body, dragonflyMaterial, [
        { position: [-1.1, 1.3, 0], rotationY: 0.4 },
        { position: [0.9, 1.5, -0.4], rotationY: -0.6 },
      ]);
      instanceAttribute(dragonflies, 'instancePhase', [0.2, 0.7]);

      const fishGeometry = new THREE.ConeGeometry(0.12, 0.7, 10, 6);
      fishGeometry.rotateX(Math.PI / 2);
      const fishPos = fishGeometry.attributes.position as THREE.BufferAttribute;
      const tail = new Float32Array(fishPos.count);
      for (let i = 0; i < fishPos.count; i += 1) tail[i] = THREE.MathUtils.clamp(fishPos.getZ(i) / 0.35, 0, 1);
      fishGeometry.setAttribute('aTailWeight', new THREE.BufferAttribute(tail, 1));
      const fishMaterial = createFishBodyMaterial(backend, new THREE.MeshStandardMaterial({ color: 0xc08a50, roughness: 0.5 }));
      const fish = instancedGrid(fishGeometry, fishMaterial, [
        { position: [-0.6, 0.25, 0.6], rotationY: 0.8 },
        { position: [0.7, 0.25, 0.9], rotationY: -1.1 },
        { position: [0.1, 0.25, -0.3], rotationY: 2.4 },
      ]);
      instanceAttribute(fish, 'instancePhase', [0.1, 0.45, 0.8]);
      instanceAttribute(fish, 'instanceFreq', [5, 6.5, 8]);

      const ringGeometry = new THREE.RingGeometry(0.25, 0.32, 32);
      ringGeometry.rotateX(-Math.PI / 2);
      const ringMaterial = createFishRingMaterial(backend, new THREE.MeshBasicMaterial({ color: 0xe8f4ff, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      const rings = instancedGrid(ringGeometry, ringMaterial, [
        { position: [-0.6, 0.02, 0.6], scale: 1.5 },
        { position: [0.7, 0.02, 0.9], scale: 2.2 },
      ]);
      instanceAttribute(rings, 'ringAlpha', [0.9, 0.5]);

      return {
        objects: [bed(0x2b4a52), dragonflies, fish, rings],
        update: (t) => {
          updateCritterMaterialTime(dragonflyMaterial, t);
          updateCritterMaterialTime(fishMaterial, t);
        },
      };
    },
  },
  {
    name: 'vfx',
    hosts: ['src/materials/vfx/vfxDualFactory.ts'],
    // SwiftShader at landing: 7.91% — TSL mist draws nothing; the TSL rainbow has no fresnel falloff.
    maxMismatch: 0.09,
    camera: { position: [0, 3, 9], target: [0, 3, 0] },
    background: 0x33424c,
    build(backend) {
      const sheetMaterial = createWaterfallSheetMaterial(backend, {
        flowSpeed: 1.4,
        baseOpacity: 0.9,
        layerOffset: 0.3,
        waterColor: new THREE.Color('#7fb8c8'),
        deepColor: new THREE.Color('#2a5a68'),
        foamColor: new THREE.Color('#ffffff'),
      });
      const sheetGeometry = new THREE.PlaneGeometry(4, 6, 24, 36);
      const sheetUv = sheetGeometry.attributes.uv as THREE.BufferAttribute;
      const depth = new Float32Array(sheetUv.count);
      for (let i = 0; i < sheetUv.count; i += 1) depth[i] = 1 - sheetUv.getY(i);
      sheetGeometry.setAttribute('curtainDepth', new THREE.BufferAttribute(depth, 1));
      const sheet = new THREE.Mesh(sheetGeometry, sheetMaterial);
      sheet.position.set(-1.6, 3, 0);

      // Rainbow.tsx: a half torus.
      const rainbowMaterial = createRainbowMaterial(backend, { opacity: 0.8, sunDirection: new THREE.Vector3(0.1, 1, 0.1) });
      const rainbow = new THREE.Mesh(new THREE.TorusGeometry(8, 0.55, 8, 64, Math.PI), rainbowMaterial);
      rainbow.scale.setScalar(0.35);
      rainbow.position.set(2.4, 1.6, -1);

      const bowMaterial = createSplashBowWaveMaterial(backend);
      const bow = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.2, 12, 4), bowMaterial);
      bow.position.set(2.2, 0.8, 0.5);

      // Mist.tsx: camera-facing instanced quads, a bank and a column.
      const mistMaterial = createMistMaterial(backend, { colorBase: new THREE.Color('#d8eaf0'), flowSpeed: 1, isSlotCanyon: false });
      const mist = instancedGrid(new THREE.PlaneGeometry(1, 1), mistMaterial, [
        { position: [-1.6, 0.6, 0.8] },
        { position: [-0.4, 1.4, 0.4] },
      ]);
      mist.geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(new Float32Array([3, 1.5, 1, 1.2, 3, 1]), 3));
      instanceAttribute(mist, 'mistType', [0, 1]);
      const animated = [sheetMaterial, rainbowMaterial, bowMaterial, mistMaterial];
      return {
        objects: [bed(0x3a4a3c), sheet, rainbow, bow, mist],
        update: (t) => {
          for (const material of animated) setUniform(material, 'time', t);
        },
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function litScene(spec: HostParityScene, built: BuiltHostScene): THREE.Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(spec.background ?? 0x6f93b8);
  scene.add(new THREE.HemisphereLight(0xd8e8ff, 0x3a3020, 0.9));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.position.set(4, 8, 5);
  scene.add(sun);
  for (const object of built.objects) scene.add(object);
  return scene;
}

function cameraFor(spec: HostParityScene): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(spec.camera.fov ?? 55, PARITY_WIDTH / PARITY_HEIGHT, 0.1, 400);
  camera.position.set(...spec.camera.position);
  camera.lookAt(...spec.camera.target);
  camera.updateMatrixWorld();
  return camera;
}

const NO_HOOK = THREE.Material.prototype.onBeforeCompile;

function glslMaterialsIn(scene: THREE.Scene): string[] {
  const found: string[] = [];
  scene.traverse((object) => {
    const material = (object as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      if ((m as THREE.ShaderMaterial).isShaderMaterial || m.onBeforeCompile !== NO_HOOK) found.push(`${object.type}:${m.type}`);
    }
  });
  return found;
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      for (const value of Object.values(m)) {
        if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      }
      m.dispose();
    }
  });
}

export async function runHostParity(only?: readonly string[]): Promise<HostParityResult[]> {
  await loadNodeMaterials();
  const glsl = createGlslParityRenderer();
  const node = await createNodeParityRenderer();
  const readback = new FrameReadback();
  const results: HostParityResult[] = [];

  const draw = async (
    renderer: { render(scene: THREE.Scene, camera: THREE.Camera): void; domElement: HTMLCanvasElement },
    spec: HostParityScene,
    backend: MaterialBackend,
  ) => {
    const built = spec.build(backend);
    const scene = litScene(spec, built);
    const camera = cameraFor(spec);
    // onBeforeCompile hosts only grow their uniforms at the first compile: draw,
    // then drive time, then draw the frame that is measured.
    renderer.render(scene, camera);
    built.update?.(PARITY_TIME);
    await settle();
    built.update?.(PARITY_TIME);
    renderer.render(scene, camera);
    readback.capture(renderer.domElement);
    const out = { stats: readback.stats(), png: readback.png(), glslMaterials: glslMaterialsIn(scene) };
    disposeScene(scene);
    return out;
  };

  for (const spec of HOST_PARITY_SCENES) {
    if (only && !only.includes(spec.name)) continue;
    const a = await draw(glsl, spec, 'glsl');
    const b = await draw(node, spec, 'tsl');
    results.push({
      scene: spec.name,
      hosts: spec.hosts,
      maxMismatch: spec.maxMismatch,
      tslFallbacks: b.glslMaterials,
      glslLuma: a.stats.luma,
      nodeLuma: b.stats.luma,
      glslPng: a.png,
      nodePng: b.png,
    });
  }

  glsl.dispose();
  node.dispose();
  return results;
}
