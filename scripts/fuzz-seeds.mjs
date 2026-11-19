#!/usr/bin/env node
/**
 * fuzz-seeds — the committed libFuzzer seeds (#575), one per case the
 * finite-or-refused rule closed, written into emscripten/fuzz-seeds/<target>/.
 *
 *   node scripts/fuzz-seeds.mjs           # (re)write the seed files
 *   node scripts/fuzz-seeds.mjs --check   # exit 1 if a committed seed is stale
 *
 * A seed is the byte stream fuzz::Input (emscripten/fuzz_input.h) reads: little-
 * endian u32 draws, in the order each target draws them (clang evaluates call
 * arguments left to right). scripts/native-fuzz.sh passes the seed directory to
 * every run, so these inputs are executed on every run, cached corpus or not.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'emscripten', 'fuzz-seeds');

const f32 = (v) => new Uint32Array(new Float32Array([v]).buffer)[0];
const NAN = 0x7fc00000;
const INF = 0x7f800000;
/** range(lo, hi) draw that lands on `t` in [0, 1]. */
const at = (t) => Math.round(t * 0xffffff);

function bytes(words) {
  const out = new Uint8Array(words.length * 4);
  const view = new DataView(out.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true));
  return out;
}

/** forces_fuzz: one batch row whose input float `slot` is `value` (raw bits), the rest physical. */
function forcesRow(slot, value) {
  const words = [1]; // coin: fuzzForces
  for (let i = 0; i < 18; i += 1) words.push(f32(0.5)); // calculateWaterForce raw args
  words.push(3, 0); // count: the default branch, pick(1, 64) -> 1 sample
  for (let k = 0; k < 8; k += 1) {
    if (k === slot) words.push(1, value); // coin -> raw
    else words.push(0, at(0.5)); // coin -> range(-50, 50)
  }
  for (let k = 0; k < 10; k += 1) words.push(1); // physical config
  words.push(0, 1); // input not null, flags plane on
  return bytes(words);
}

/** swe_fuzz: a 12 x 10 grid, one applySWEEvent with a finite radius of ~3e38. */
function sweHugeRadius() {
  const words = [11, 9, at(0.4), at(0.2), 1, 0x2545f491, at(0.2), 0]; // w, h, H, dx, bed, state, dryShare, ops=1
  words.push(2); // op: event
  words.push(at(0.5), 1, 0, 0xffffff); // radius: scalar(0, 20), then huge -> range(-1, 1) * 3e38 at the top
  words.push(at(0.5), 1, 1); // strength: scalar, not huge
  words.push(at(0.5), 1, 1); // dt: scalar, not huge
  words.push(1); // dx: not special
  words.push(at(0.5), 1, 1, at(0.5), 1, 1); // originX, originZ
  words.push(1, 1); // H: not special, not huge
  words.push(0); // kind 0
  words.push(at(0.5), 1, 1, at(0.5), 1, 1); // cx, cz
  return bytes(words);
}

export const SEEDS = {
  forces: {
    'nan-pos-y': forcesRow(1, NAN),
    'inf-vel-x': forcesRow(3, INF),
    'huge-vel-x': forcesRow(3, f32(3e19)),
  },
  swe: {
    'event-huge-radius': sweHugeRadius(),
  },
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [target, seeds] of Object.entries(SEEDS)) {
    mkdirSync(join(dir, target), { recursive: true });
    for (const [name, data] of Object.entries(seeds)) {
      const path = join(dir, target, name);
      if (check) {
        let current = null;
        try { current = readFileSync(path); } catch { /* missing */ }
        if (!current || Buffer.compare(current, Buffer.from(data)) !== 0) stale.push(`${target}/${name}`);
      } else writeFileSync(path, data);
    }
  }
  if (stale.length) {
    console.error(`[fuzz-seeds] stale: ${stale.join(', ')} (node scripts/fuzz-seeds.mjs)`);
    process.exit(1);
  }
}
