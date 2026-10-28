#!/usr/bin/env node
/**
 * CI guard: the watershed_native heap is fixed-size, and nothing rebinds views.
 *
 * ALLOW_MEMORY_GROWTH=1 replaced the wasm ArrayBuffer on growth and silently
 * detached every typed view made before it (#415), so eight modules rebound
 * their views on every read. The heap is fixed now (emscripten/CMakeLists.txt),
 * views are made once, and this keeps it that way:
 *   - CMakeLists.txt links ALLOW_MEMORY_GROWTH=0 and ABORTING_MALLOC=0 (a
 *     failed malloc returns NULL → WasmHeapExhaustedError, not an abort), and
 *     sets no MAXIMUM_MEMORY;
 *   - no src/ module (tests included) passes heapF32 a previous view to
 *     reuse, compares a view's buffer with HEAPF32.buffer to detect growth,
 *     or checks a heap view for detachment.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

const cmake = readFileSync(join(root, 'emscripten', 'CMakeLists.txt'), 'utf8');
if (!/-s ALLOW_MEMORY_GROWTH=0\b/.test(cmake)) failures.push('emscripten/CMakeLists.txt: link with -s ALLOW_MEMORY_GROWTH=0');
if (!/-s ABORTING_MALLOC=0\b/.test(cmake)) failures.push('emscripten/CMakeLists.txt: link with -s ABORTING_MALLOC=0');
if (/MAXIMUM_MEMORY/.test(cmake)) failures.push('emscripten/CMakeLists.txt: MAXIMUM_MEMORY only means something with growth');

/** Rebinding idioms, each with what to do instead. */
const BANNED = [
  [/heapF32\([^()]*,[^()]*,[^()]*,[^()]*\)/, 'heapF32 takes no previous view: make the view once'],
  [/\.buffer\s*(?:===|!==)\s*[\w.]+\.HEAPF32\.buffer\b/, 'a view never needs a growth check'],
  [/\bbyteLength\s*(?:===|!==)\s*0\b.*HEAPF32|HEAPF32.*\bbyteLength\s*(?:===|!==)\s*0\b/, 'a heap view never detaches'],
  [/\b(?:memory growth|heap growth|ALLOW_MEMORY_GROWTH)\b.*\b(?:rebind|re-?derive|detach)/i, 'stale growth comment: the heap is fixed'],
  [/\b(?:rebind|re-?derive|detach)\w*\b.*\b(?:memory growth|heap growth|grows the heap)\b/i, 'stale growth comment: the heap is fixed'],
];

/** `watershedHost.ts` asks whether an input already lives on the heap: not a growth check. */
const ALLOWED = new Map([
  ['src/rendering/gpuChores/watershedHost.ts', /const onHeap = values\.buffer === wasm\.HEAPF32\.buffer;/],
]);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (/\.(?:ts|tsx|mjs|js)$/.test(name)) yield path;
  }
}

let scanned = 0;
for (const path of files(join(root, 'src'))) {
  scanned += 1;
  const rel = relative(root, path).split('\\').join('/');
  const allowed = ALLOWED.get(rel);
  readFileSync(path, 'utf8').split('\n').forEach((line, i) => {
    if (allowed?.test(line)) return;
    for (const [pattern, why] of BANNED) {
      if (pattern.test(line)) failures.push(`${rel}:${i + 1}: ${why}\n      ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error('[fixed-heap] the wasm heap is fixed-size; nothing may rebind views (WASM.md, Memory):');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`[fixed-heap] ok — ALLOW_MEMORY_GROWTH=0, ${scanned} src files, no view rebinding`);
