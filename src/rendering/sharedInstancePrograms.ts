/**
 * sharedInstancePrograms — one program per material for every InstancedMesh on
 * the node renderer, instead of one per mesh (#576 A.1).
 *
 * WHAT IT FIXES: r185's `createInstanceMatrixNode` (nodes/accessors/Instance.js)
 * puts an InstancedMesh's matrices in a uniform buffer whenever
 * `count * 64 <= builder.getUniformBufferLimit()` — every instanced layer of
 * ≤ 256–1024 instances, i.e. nearly every decoration layer here. The GLSL
 * backend names that block after the buffer node's id (`NodeBuffer_<id>`,
 * `buffer<id>[<count>]`, GLSLNodeBuilder), so two meshes that share a material
 * still emit different vertex source, and the node renderer builds one program
 * per mesh. Measured on the scripted meander (SwiftShader, `?material=tsl`):
 * 743 links in the first 3 s, 730 distinct vertex shaders over 57 fragment
 * shaders, and 58 distinct programs once the block name and size are taken
 * out of the source.
 *
 * Above the limit three already takes the other path: the matrices as four
 * interleaved instanced `vec4` attributes, named by attribute index, so the
 * source is the same for every mesh with the same material — which is also
 * what `THREE.WebGLRenderer` does for every InstancedMesh. Reporting a limit of
 * 0 sends every InstancedMesh down that path. In r185 the limit has exactly two
 * readers, both instancing (`Instance.js`, `RangeNode.js`);
 * `sharedInstancePrograms.test.ts` pins that against the real bundle, so a three
 * bump that adds a third reader or moves the switch fails the test instead of
 * quietly bringing the per-mesh programs back.
 *
 * Applied once, right after `renderer.init()` (the backends create their
 * capabilities object in their constructor / `init`). Defensive like
 * `programCount.ts`: a renderer whose capabilities moved is left alone and the
 * call returns false.
 */

interface CapabilitiesShape {
  getUniformBufferLimit?: () => number;
}

interface NodeRendererShape {
  isWebGPURenderer?: boolean;
  backend?: { capabilities?: CapabilitiesShape | null } | null;
}

/** The limit the node builder sees: no instance-matrix buffer fits under it. */
export const INSTANCE_UNIFORM_BUFFER_LIMIT = 0;

/**
 * Route every InstancedMesh's matrices through instanced attributes on this
 * node renderer. Returns whether the override was installed.
 */
export function shareInstancePrograms(renderer: unknown): boolean {
  if (!renderer || typeof renderer !== 'object') return false;
  const node = renderer as NodeRendererShape;
  if (node.isWebGPURenderer !== true) return false;
  const capabilities = node.backend?.capabilities;
  if (!capabilities || typeof capabilities.getUniformBufferLimit !== 'function') return false;
  capabilities.getUniformBufferLimit = () => INSTANCE_UNIFORM_BUFFER_LIMIT;
  return true;
}
