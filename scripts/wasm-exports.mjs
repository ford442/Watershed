#!/usr/bin/env node
/**
 * Print the sorted `_ws_*` exports (with arity) of a watershed_native pair.
 *
 *   node scripts/wasm-exports.mjs [dir]                 # default: public/
 *   node scripts/wasm-exports.mjs public emscripten/build/out   # diff two pairs; exit 1 if they differ
 *
 * The C ABI (#467) is meant to be emcc-version-independent: the same sources
 * built with the pinned emcc and with a current emsdk must expose the same
 * list. CI's "WASM exports on current emsdk" job runs the two-argument form.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function exportsOf(dir) {
  const glue = await import(pathToFileURL(resolve(dir, 'watershed_native.js')).href);
  const raw = await glue.default({ wasmBinary: readFileSync(resolve(dir, 'watershed_native.wasm')) });
  return Object.keys(raw)
    .filter((k) => k.startsWith('_ws_') && typeof raw[k] === 'function')
    .map((k) => `${k}/${raw[k].length}`)
    .sort();
}

const dirs = process.argv.slice(2);
if (dirs.length <= 1) {
  for (const line of await exportsOf(dirs[0] ?? 'public')) console.log(line);
} else {
  const [a, b] = await Promise.all(dirs.slice(0, 2).map(exportsOf));
  const onlyA = a.filter((x) => !b.includes(x));
  const onlyB = b.filter((x) => !a.includes(x));
  console.log(`${dirs[0]}: ${a.length} exports, ${dirs[1]}: ${b.length} exports`);
  for (const x of onlyA) console.log(`  only in ${dirs[0]}: ${x}`);
  for (const x of onlyB) console.log(`  only in ${dirs[1]}: ${x}`);
  if (onlyA.length || onlyB.length) process.exit(1);
  console.log('export lists match');
}
