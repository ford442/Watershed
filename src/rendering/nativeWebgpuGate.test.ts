import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canEnableNativeWebgpu, mustForceWebGLForNodeRenderer, POST_STACK_PORTED, residualGlslHostCount } from './nativeWebgpuGate';

const allowlist = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../scripts/glsl-hosts-allowlist.json'), 'utf8'),
) as { hosts: Array<{ path: string; kind: string }>; maxResidual: number };

describe('native WebGPU gate', () => {
  it('opens once post is ported and no residual GLSL host remains (epic #434 B2)', () => {
    const residual = allowlist.hosts.filter((h) => h.kind === 'residual');
    expect(residual.length).toBe(residualGlslHostCount());
    expect(residualGlslHostCount()).toBe(0);
    expect(allowlist.maxResidual).toBe(0);
    expect(POST_STACK_PORTED).toBe(true);
    expect(canEnableNativeWebgpu()).toBe(true);
    expect(mustForceWebGLForNodeRenderer()).toBe(false);
  });
});
