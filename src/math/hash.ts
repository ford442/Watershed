/**
 * hash.ts — the one stateless scalar hash on the JS side (#503 A).
 *
 * `fract(sin(n) · 43758.5453)` is the hash the GLSL/TSL bodies use
 * (`materials/tsl/noise.ts`); scenery hosts that hash an instance index keep it
 * so their layouts do not move. Each caller scales `n` by its own constant
 * (`sinHash(i * 12.9898)`) to decorrelate from the others.
 *
 * Not a PRNG: neighbouring inputs are correlated at small scales and the
 * quality is float-precision bound. Anything that draws a *sequence* uses
 * `createRng` from `./random`.
 */

/** `fract(sin(n) · 43758.5453)`, in `[0, 1)`. */
export function sinHash(n: number): number {
  const x = Math.sin(n) * 43758.5453;
  return x - Math.floor(x);
}
