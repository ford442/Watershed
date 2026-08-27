/**
 * Native WebGPU (`forceWebGL: false`) is allowed only when every residual
 * GLSL host is gone AND the JSM post stack has a node-capable path.
 *
 * Residual construction sites are listed in scripts/glsl-hosts-allowlist.json.
 * Until that list is empty *and* POST_STACK_PORTED is flipped, TSL stays on
 * WebGL2 (`forceWebGL: true`) even if `?renderer=webgpu` is set.
 */
import allowlist from '../../scripts/glsl-hosts-allowlist.json';

export const POST_STACK_PORTED = false;

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
