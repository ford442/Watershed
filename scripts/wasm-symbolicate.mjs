#!/usr/bin/env node
/**
 * Map a watershed_native trap to function names (#502 B).
 *
 *   node scripts/wasm-symbolicate.mjs '<stack text>'           # committed map
 *   pbpaste | node scripts/wasm-symbolicate.mjs                # stack on stdin
 *   node scripts/wasm-symbolicate.mjs 57                       # one function index
 *   node scripts/wasm-symbolicate.mjs --map build-sourcemaps/watershed_native.<stamp>.symbols '<stack>'
 *
 * A release binary has no name section, so a field stack reads
 * `wasm-function[57]:0x1a2b`. `--emit-symbol-map` (emscripten/CMakeLists.txt)
 * writes `N:name` per function index; build.sh commits the shipped pair's as
 * emscripten/watershed_native.symbols and Vite copies it into
 * build-sourcemaps/ under the pair stamp. Use the map whose stamp matches the
 * report's `stamp=` (the loader logs it on every init).
 *
 * Every `wasm-function[N]` in the input is rewritten as `name (wasm-function[N])`;
 * a bare index prints its name. Exit 1 when an index is not in the map.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let mapPath = resolve(root, 'emscripten/watershed_native.symbols');
const at = args.indexOf('--map');
if (at >= 0) {
  mapPath = resolve(args[at + 1] ?? '');
  args.splice(at, 2);
}

const symbols = new Map();
for (const line of readFileSync(mapPath, 'utf8').split(/\r?\n/)) {
  const colon = line.indexOf(':');
  if (colon > 0) symbols.set(Number(line.slice(0, colon)), line.slice(colon + 1).trim());
}

let input = args.join(' ');
if (!input) input = readFileSync(0, 'utf8');

let missing = 0;
if (/^\s*\d+\s*$/.test(input)) {
  const index = Number(input.trim());
  const name = symbols.get(index);
  if (!name) missing += 1;
  console.log(name ?? `wasm-function[${index}] is not in ${mapPath}`);
} else {
  const out = input.replace(/wasm-function\[(\d+)\]/g, (whole, n) => {
    const name = symbols.get(Number(n));
    if (!name) {
      missing += 1;
      return whole;
    }
    return `${name} (${whole})`;
  });
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
}
process.exit(missing > 0 ? 1 : 0);
