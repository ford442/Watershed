/**
 * sweChecksum.ts — a fingerprint of the live SWE state, for replay checks.
 *
 * FNV-1a over the bit patterns of η, u and w (32-bit words), so two runs that
 * stepped the same water the same way hash identically and any drift — one
 * ulp in one cell — hashes apart. SplitRecorder takes one at every split;
 * `?replay=` smoke runs compare them across replays of one ghost.
 *
 * Read on demand (a split, a test), never per frame. On the `wasm-worker`
 * backend the fields are the main-thread mirror of the worker's last frame.
 */

/** The fields a checksum reads; any SweSim satisfies it. */
export interface SweChecksumFields {
  readonly h: Float32Array;
  readonly u: Float32Array;
  readonly w: Float32Array;
}

/** 8-hex FNV-1a over the fields' float bits, in order h, u, w. */
export function checksumSweState(fields: SweChecksumFields): string {
  let hash = 0x811c9dc5;
  for (const field of [fields.h, fields.u, fields.w]) {
    const words = new Uint32Array(field.buffer, field.byteOffset, field.length);
    for (let i = 0; i < words.length; i += 1) {
      hash ^= words[i];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

let live: SweChecksumFields | null = null;

/** The SWE host names its live grid each frame (null when the field is off or gone). */
export function setSweChecksumGrid(grid: SweChecksumFields | null): void {
  live = grid;
}

/** Checksum of the live SWE state, or null with no field (SWE off at Low quality). */
export function currentSweChecksum(): string | null {
  return live ? checksumSweState(live) : null;
}
