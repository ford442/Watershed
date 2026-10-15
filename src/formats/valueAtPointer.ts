/**
 * Resolve an ajv `instancePath` (a JSON Pointer such as `/segments/0/biome`) against the
 * document that was validated.
 *
 * The precompiled validators are generated without `verbose` (it adds ~48 kB per validator),
 * so errors no longer carry `err.data`. For every keyword the callers care about, `data` was
 * exactly the value at `instancePath`, which this recovers. `validators.drift.test.ts` pins
 * that equivalence against a verbose ajv on real and mutated documents.
 */
export function valueAtPointer(root: unknown, pointer: string): unknown {
  if (pointer === '') return root;
  let cursor: unknown = root;
  for (const raw of pointer.split('/').slice(1)) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}
