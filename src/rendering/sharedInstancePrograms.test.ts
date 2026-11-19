/**
 * The node renderer must not build a program per InstancedMesh (#576 A.1). The
 * first block drives stand-in renderers; the second pins the r185 internals the
 * override relies on against the REAL `three.webgpu.js` bundle (vitest.config.ts
 * aliases `three/webgpu` to a test double), so a three bump that moves the
 * instance-matrix switch, or gives the limit a reader that is not instancing,
 * fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { INSTANCE_UNIFORM_BUFFER_LIMIT, shareInstancePrograms } from './sharedInstancePrograms';

describe('shareInstancePrograms', () => {
  it('reports a limit no instance-matrix buffer fits under', () => {
    const capabilities = { getUniformBufferLimit: () => 65536 };
    expect(shareInstancePrograms({ isWebGPURenderer: true, backend: { capabilities } })).toBe(true);
    expect(capabilities.getUniformBufferLimit()).toBe(INSTANCE_UNIFORM_BUFFER_LIMIT);
    // createInstanceMatrixNode: `count * 16 * 4 <= limit` picks the per-mesh uniform block.
    expect(1 * 16 * 4 <= INSTANCE_UNIFORM_BUFFER_LIMIT).toBe(false);
  });

  it('leaves the classic WebGLRenderer, and anything without the field, alone', () => {
    expect(shareInstancePrograms({ isWebGPURenderer: false, backend: { capabilities: { getUniformBufferLimit: () => 1 } } })).toBe(false);
    expect(shareInstancePrograms({ isWebGPURenderer: true, backend: { capabilities: null } })).toBe(false);
    expect(shareInstancePrograms({ isWebGPURenderer: true })).toBe(false);
    expect(shareInstancePrograms(null)).toBe(false);
  });
});

const REAL_WEBGPU_BUNDLE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../node_modules/three/build/three.webgpu.js',
);

describe('shareInstancePrograms against the real three r185 bundle', () => {
  const source = readFileSync(REAL_WEBGPU_BUNDLE, 'utf8');

  it('the GLSL builder still names a uniform buffer after its node id (why this exists)', () => {
    expect(source).toContain('node.name = `NodeBuffer_${ node.id }`;');
    expect(source).toContain('uniformNode.name = `buffer${ node.id }`;');
  });

  it('every reader of the limit is an instancing size switch', () => {
    const reads = source.split('builder.getUniformBufferLimit()').length - 1;
    // createInstanceMatrixNode, instance() (the interleave sync) and RangeNode.
    expect(reads).toBe(3);
    const lines = source.split('\n');
    const sites = lines
      .map((line, i) => (line.includes('builder.getUniformBufferLimit()') ? i : -1))
      .filter((i) => i >= 0);
    for (const i of sites) {
      // Each compares a `count * … * 4` byte size against it, two lines above.
      expect(lines.slice(i - 2, i + 1).join('\n')).toMatch(/const uniformBufferSize = (object\.)?count \* \d+ \* 4/);
    }
  });

  it('the override reaches the node builder on a real renderer', async () => {
    const real = await import(/* @vite-ignore */ REAL_WEBGPU_BUNDLE);
    // The WebGPU backend builds its capabilities in its constructor; no adapter is needed.
    const renderer = new real.WebGPURenderer({ canvas: document.createElement('canvas'), forceWebGL: false });
    expect(shareInstancePrograms(renderer)).toBe(true);
    const builder = new real.NodeBuilder(new THREE.Mesh(), renderer);
    expect(builder.getUniformBufferLimit()).toBe(INSTANCE_UNIFORM_BUFFER_LIMIT);
  });
});
