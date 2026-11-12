/**
 * programCount — the live GPU programs of either renderer, as one list (#555 A.3).
 *
 * The shader warm-up and its first-3-s report count programs. The classic
 * `WebGLRenderer` lists them in `info.programs` (one per linked program). The
 * node renderer has no such list: its unit is the *pipeline* (`Pipelines.caches`,
 * one per vertex/fragment pair and render state — and on the WebGL2 backend
 * exactly one linked program each), which three keeps on a private field. Its
 * public `info.memory.programs` counts shader *stages* instead, which neither
 * matches a link nor is comparable with the GLSL number, so it is not used.
 *
 * The node read is defensive: a three bump that moves the field returns null,
 * and the callers report "not listed" rather than a wrong count.
 */

interface WebGLInfoShape {
  info?: { programs?: unknown };
}

interface NodeRendererShape {
  isWebGPURenderer?: boolean;
  _pipelines?: { caches?: unknown } | null;
}

/** What `liveProgramLabel` reads off either kind of entry. */
interface ProgramLike {
  /** WebGLProgram: the material's name/type. */
  name?: string;
  /** WebGLProgram's key; a node pipeline's too. */
  cacheKey?: string;
  vertexProgram?: { name?: string };
  fragmentProgram?: { name?: string };
  computeProgram?: { name?: string };
}

/**
 * The renderer's live programs (GLSL: `info.programs`; node: its pipeline cache),
 * or null where neither is readable — the node renderer before `init()`, or a
 * three version whose internals moved. Entries are the renderer's own objects,
 * so two reads can be diffed by identity.
 */
export function liveProgramList(renderer: unknown): readonly object[] | null {
  if (!renderer || typeof renderer !== 'object') return null;
  if ((renderer as NodeRendererShape).isWebGPURenderer === true) {
    const caches = (renderer as NodeRendererShape)._pipelines?.caches;
    return caches instanceof Map ? [...caches.values()] : null;
  }
  const programs = (renderer as WebGLInfoShape).info?.programs;
  return Array.isArray(programs) ? programs : null;
}

/** `liveProgramList(renderer).length`, or null where the list is not readable. */
export function liveProgramCount(renderer: unknown): number | null {
  return liveProgramList(renderer)?.length ?? null;
}

/** A short label for a `?debug=1` listing: the program's name, else its key's head. */
export function liveProgramLabel(entry: object): string {
  const p = entry as ProgramLike;
  const stages = p.computeProgram?.name ?? [p.vertexProgram?.name, p.fragmentProgram?.name].filter(Boolean).join('+');
  return p.name || stages || (p.cacheKey ?? '?').slice(0, 48);
}
