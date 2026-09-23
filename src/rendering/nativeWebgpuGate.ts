/**
 * Native WebGPU (`forceWebGL: false`) is allowed only when every residual
 * GLSL host is gone AND the JSM post stack has a node-capable path.
 *
 * Residual construction sites are listed in scripts/glsl-hosts-allowlist.json.
 * The post stack's node twin landed in epic #434 B2
 * (src/components/postProcessing/nodePostPipeline.ts), so both halves hold and
 * `?material=tsl&renderer=webgpu` negotiates native WebGPU. Adding a residual
 * host back closes the gate again.
 */
import allowlist from '../../scripts/glsl-hosts-allowlist.json';

export const POST_STACK_PORTED = true;

export function residualGlslHostCount(): number {
  return (allowlist.hosts as Array<{ kind: string }>).filter((h) => h.kind === 'residual').length;
}

export function canEnableNativeWebgpu(): boolean {
  return POST_STACK_PORTED && residualGlslHostCount() === 0;
}

/** Node renderer must keep the WebGL2 backend while this returns true. */
export function mustForceWebGLForNodeRenderer(): boolean {
  return !canEnableNativeWebgpu();
}
