/**
 * Shader-host guard for the simulated surface field (#453).
 *
 * createWaterMaterial.test.ts proves both hosts expose the same uniform KEYS, but both
 * derive them from WATER_UNIFORM_NAMES, so it cannot catch a host that declares the uniform
 * and never reads it. These checks read the sources: both hosts must declare / sample
 * `sweFlowMap` in the FRAGMENT stage and take their thresholds from WATER_SHADER.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATER_TEXTURE_UNIFORM_NAMES, WATER_UNIFORM_NAMES } from './waterUniformSpec';

const root = resolve(__dirname, '../..');
const glslSource = readFileSync(resolve(root, 'components/FlowingWater.tsx'), 'utf8');
const tslSource = readFileSync(resolve(root, 'materials/water/WaterNodeMaterial.ts'), 'utf8');

const TUNABLES = [
  'SWE_STREAK_MIN_SPEED',
  'SWE_STREAK_FULL_SPEED',
  'SWE_WET_BAND',
  'SWE_JUMP_DIV_LO',
  'SWE_JUMP_DIV_HI',
  'SWE_JUMP_FOAM_INTENSITY',
  'SWE_ANALYTIC_SCALE',
  'SWE_WINDOW_FEATHER_CELLS',
];

/** Slice of the GLSL fragment string (`builtinFragmentShader`) out of FlowingWater.tsx. */
function glslFragment(): string {
  const start = glslSource.indexOf('const builtinFragmentShader');
  expect(start, 'builtinFragmentShader not found').toBeGreaterThan(-1);
  const end = glslSource.indexOf('// Load dynamic shader', start);
  expect(end).toBeGreaterThan(start);
  return glslSource.slice(start, end);
}

/** Slice of `buildColorNode` (the TSL fragment graph) out of WaterNodeMaterial.ts. */
function tslFragment(): string {
  const start = tslSource.indexOf('function buildColorNode');
  expect(start, 'buildColorNode not found').toBeGreaterThan(-1);
  const end = tslSource.indexOf('export function createWaterNodeMaterial', start);
  expect(end).toBeGreaterThan(start);
  return tslSource.slice(start, end);
}

describe('sweFlowMap uniform', () => {
  it('is registered as a texture uniform on both backends', () => {
    expect(WATER_UNIFORM_NAMES).toContain('sweFlowMap');
    expect(WATER_TEXTURE_UNIFORM_NAMES).toContain('sweFlowMap');
  });

  it('is declared and sampled in the GLSL fragment stage', () => {
    const frag = glslFragment();
    expect(frag).toContain('uniform sampler2D sweFlowMap;');
    expect(frag).toMatch(/texture2D\(\s*sweFlowMap\b/);
    // Everything the fragment needs to place a world XZ in the grid.
    for (const name of ['sweOrigin', 'sweCellSize', 'sweGridSize', 'sweEnabled']) {
      expect(frag).toContain(`uniform ${name === 'sweOrigin' || name === 'sweGridSize' ? 'vec2' : 'float'} ${name};`);
    }
  });

  it('is sampled in the TSL fragment graph', () => {
    expect(tslFragment()).toMatch(/nd\(u\.sweFlowMap\)\.sample\(/);
  });

  it('gates the SWE-driven terms on the window mask in both hosts', () => {
    expect(glslFragment()).toContain('sweWindowMask(');
    expect(tslFragment()).toContain('sweWindowMask(');
  });

  it('scales the analytic displacement in both vertex stages', () => {
    expect(glslSource).toMatch(/getDisplacement\(pos\.xz, flowBias\) \* analyticScale/);
    expect(tslSource).toMatch(/\.mul\(analyticScale\)/);
  });
});

describe('shared SWE surface thresholds', () => {
  it.each(TUNABLES)('%s comes from WATER_SHADER in both hosts', (name) => {
    expect(glslSource).toContain(`${name}: WATER_SHADER.${name}`);
    expect(tslSource).toContain(`WATER_SHADER.${name}`);
  });
});
