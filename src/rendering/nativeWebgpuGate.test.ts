import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canEnableNativeWebgpu, mustForceWebGLForNodeRenderer, POST_STACK_PORTED, residualGlslHostCount } from './nativeWebgpuGate';

const allowlist = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/glsl-hosts-allowlist.json'), 'utf8'),
) as { hosts: Array<{ path: string; kind: string }>; maxResidual: number };

describe('native WebGPU gate', () => {
  it('stays closed while residual GLSL hosts remain or post is unported', () => {
    const residual = allowlist.hosts.filter((h) => h.kind === 'residual');
    expect(residual.length).toBe(residualGlslHostCount());
    expect(residualGlslHostCount()).toBeGreaterThan(0);
    expect(residual.length).toBeLessThanOrEqual(allowlist.maxResidual);
    expect(POST_STACK_PORTED).toBe(false);
    expect(canEnableNativeWebgpu()).toBe(false);
    expect(mustForceWebGLForNodeRenderer()).toBe(true);
  });
});
