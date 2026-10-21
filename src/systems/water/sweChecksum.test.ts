import { afterEach, describe, expect, it } from 'vitest';
import { checksumSweState, currentSweChecksum, setSweChecksumGrid } from './sweChecksum';

const field = (n: number, seed: number) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 1.3 + seed) * 0.1);

afterEach(() => setSweChecksumGrid(null));

describe('checksumSweState', () => {
  it('is the same for the same water and moves on a one-ulp change in one cell', () => {
    const a = { h: field(64, 1), u: field(64, 2), w: field(64, 3) };
    const b = { h: a.h.slice(), u: a.u.slice(), w: a.w.slice() };
    expect(checksumSweState(b)).toBe(checksumSweState(a));
    const bits = new Uint32Array(b.w.buffer);
    bits[17] += 1;
    expect(checksumSweState(b)).not.toBe(checksumSweState(a));
  });

  it('reads views in place (a heap subarray hashes like its copy)', () => {
    const heap = new Float32Array(300);
    heap.set(field(64, 1), 10);
    heap.set(field(64, 2), 100);
    heap.set(field(64, 3), 200);
    const views = { h: heap.subarray(10, 74), u: heap.subarray(100, 164), w: heap.subarray(200, 264) };
    const copies = { h: views.h.slice(), u: views.u.slice(), w: views.w.slice() };
    expect(checksumSweState(views)).toBe(checksumSweState(copies));
  });

  it('is null with no live field', () => {
    expect(currentSweChecksum()).toBeNull();
    setSweChecksumGrid({ h: field(4, 1), u: field(4, 2), w: field(4, 3) });
    expect(currentSweChecksum()).toMatch(/^[0-9a-f]{8}$/);
  });
});
