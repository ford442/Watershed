#!/usr/bin/env node
/** Compare always-new Float32Array vs lazy heapF32 on the water-force path. */

function heapF32(mod, ptr, count, prev) {
  if (prev && prev.byteLength !== 0 && prev.buffer === mod.HEAPF32.buffer) {
    return prev;
  }
  return new Float32Array(mod.HEAPF32.buffer, ptr, count);
}

function bench(label, n, fn) {
  const t0 = performance.now();
  fn(n);
  const ms = performance.now() - t0;
  const ns = (ms * 1e6) / n;
  console.log(`${label.padEnd(40)} ${n.toString().padStart(8)} iters  ${ms.toFixed(2).padStart(8)} ms  ${ns.toFixed(1).padStart(8)} ns/op`);
  return ns;
}

const smallCount = 8;
const sweCount = 32 * 32;
const N = 200_000;

const buf = new ArrayBuffer(sweCount * 4 + 64);
const mod = { HEAPF32: new Float32Array(buf) };
let small = new Float32Array(buf, 0, smallCount);
let swe = new Float32Array(buf, 0, sweCount);

console.log('HEAPF32 view strategy (frame-hot path)\n');

const alwaysSmall = bench('always-new 8-float', N, (n) => {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(mod.HEAPF32.buffer, 0, smallCount);
    acc += v.length;
  }
  return acc;
});

const lazySmall = bench('heapF32 lazy 8-float (same buffer)', N, (n) => {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    small = heapF32(mod, 0, smallCount, small);
    acc += small.length;
  }
  return acc;
});

const alwaysSwe = bench('always-new 32x32 SWE', N, (n) => {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = new Float32Array(mod.HEAPF32.buffer, 0, sweCount);
    acc += v.length;
  }
  return acc;
});

const lazySwe = bench('heapF32 lazy 32x32 SWE (same buffer)', N, (n) => {
  let acc = 0;
  for (let i = 0; i < n; i++) {
    swe = heapF32(mod, 0, sweCount, swe);
    acc += swe.length;
  }
  return acc;
});

const grown = new ArrayBuffer(buf.byteLength + 4096);
new Uint8Array(grown).set(new Uint8Array(buf));
mod.HEAPF32 = new Float32Array(grown);
const afterGrowth = bench('heapF32 after simulated growth', N, (n) => {
  let prev;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    prev = heapF32(mod, 0, smallCount, prev);
    acc += prev.length;
  }
  return acc;
});

console.log('\nPick:');
console.log(`  8-float water-force: ${lazySmall < alwaysSmall ? 'lazy heapF32' : 'always-new'} (${lazySmall.toFixed(1)} vs ${alwaysSmall.toFixed(1)} ns/op)`);
console.log(`  SWE 32x32:           ${lazySwe < alwaysSwe ? 'lazy heapF32' : 'always-new'} (${lazySwe.toFixed(1)} vs ${alwaysSwe.toFixed(1)} ns/op)`);
console.log(`  after growth (8-float rebuild): ${afterGrowth.toFixed(1)} ns/op`);
