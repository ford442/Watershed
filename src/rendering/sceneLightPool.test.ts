import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as THREE from 'three';
import { selectPointLights, type PointLightRequest } from './sceneLightPool';

const request = (x: number, intensity: number): PointLightRequest => ({
  position: new THREE.Vector3(x, 0, 0),
  color: new THREE.Color('#ffffff'),
  intensity,
  distance: 3,
  decay: 2,
});

describe('selectPointLights', () => {
  const eye = new THREE.Vector3(0, 0, 0);

  it('keeps the brightest-at-the-eye requests, best first', () => {
    const near = request(2, 0.5);
    const far = request(40, 2);
    const mid = request(5, 1);
    const out: PointLightRequest[] = [];
    expect(selectPointLights([far, near, mid], eye, 2, out)).toBe(2);
    expect(out).toEqual([near, mid]);
  });

  it('skips dark requests and never exceeds the pool', () => {
    const lit = Array.from({ length: 9 }, (_, i) => request(i + 1, 1));
    const out: PointLightRequest[] = [];
    expect(selectPointLights([request(0, 0), ...lit, request(0.5, Number.NaN)], eye, 6, out)).toBe(6);
    expect(out).toEqual(lit.slice(0, 6));
  });

  it('reuses `out` across frames and handles an empty pool', () => {
    const out: PointLightRequest[] = [request(1, 1), request(2, 1), request(3, 1)];
    expect(selectPointLights([request(4, 1)], eye, 6, out)).toBe(1);
    expect(out).toHaveLength(1);
    expect(selectPointLights([request(4, 1)], eye, 0, out)).toBe(0);
    expect(out).toHaveLength(0);
  });
});

/**
 * three.js bakes the light count into every lit program, so a light that mounts
 * with a treadmill segment recompiles the whole scene on every append (#487).
 * Segment content borrows from sceneLightPool instead. The allowlist is lights
 * mounted once per session.
 */
const SRC = join(__dirname, '..');
const SESSION_LIGHTS = new Set([
  'experience/SceneLighting.tsx',
  'rendering/sceneLightPool.tsx',
  'components/EnhancedSky.tsx',
  'vehicles/RaftVehicle.tsx',
  'components/LevelEditor/LevelEditor.tsx',
  // Its own offscreen scene (post-processing parity harness).
  'debug/postParity.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__mocks__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('scene light count', () => {
  it('only session-lifetime components mount lights', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) =>
        /<(point|spot|hemisphere|ambient|directional|rectArea)Light\b|new THREE\.(Point|Spot|Hemisphere|RectArea)Light\(/.test(
          readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''),
        ),
      )
      .map((file) => relative(SRC, file).split('\\').join('/'))
      .filter((file) => !SESSION_LIGHTS.has(file));
    expect(offenders).toEqual([]);
  });
});
