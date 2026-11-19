#!/usr/bin/env node
/**
 * gen-abi — the watershed_native C ABI from its one declaration (#575).
 *
 * Reads emscripten/abi.def and writes:
 *   emscripten/abi_generated.h              constants, the extern "C" ws_* wrappers, struct layout asserts
 *   src/systems/water/wasmAbi.generated.ts  constants, the branded export interface, the WASM_ABI table
 *   WASM.md                                 the export table between the gen-abi markers
 *
 *   node scripts/gen-abi.mjs          # (re)write the three files (pnpm gen:abi)
 *   node scripts/gen-abi.mjs --check  # exit 1 on drift, or when an implementation
 *                                     # header's prototype disagrees with abi.def
 *
 * --check runs in `pnpm typecheck` and as a step of every CMake build
 * (emscripten/CMakeLists.txt, target abi_check), so a parameter swap in
 * abi.def, in a header, or in a generated file fails the native build.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEF = join(root, 'emscripten', 'abi.def');
export const OUTPUTS = {
  header: join(root, 'emscripten', 'abi_generated.h'),
  ts: join(root, 'src', 'systems', 'water', 'wasmAbi.generated.ts'),
  md: join(root, 'WASM.md'),
};
const MD_BEGIN = '<!-- gen-abi:begin (scripts/gen-abi.mjs from emscripten/abi.def; do not edit) -->';
const MD_END = '<!-- gen-abi:end -->';

/** Argument kinds: C type, TS type (wasmUnits.ts), and whether TS sees the argument at all. */
const KINDS = {
  PtrF32: { c: 'uintptr_t', ts: 'Ptr<F32>' },
  PtrU32: { c: 'uintptr_t', ts: 'Ptr<U32>' },
  PtrU8: { c: 'uintptr_t', ts: 'Ptr<U8>' },
  PtrSoA: { c: 'uintptr_t', ts: 'Ptr<ParticleSoA>' },
  OutU32: { c: 'uintptr_t', ts: null },
  Cells: { c: 'int', ts: 'Cells' },
  Count: { c: 'int', ts: 'number' },
  Index: { c: 'int', ts: 'number' },
  U32: { c: 'uint32_t', ts: 'number' },
  F32: { c: 'float', ts: 'number' },
  Seconds: { c: 'float', ts: 'Seconds' },
  Metres: { c: 'float', ts: 'Metres' },
  MetresPerSecond: { c: 'float', ts: 'MetresPerSecond' },
  MetresPerSecondSquared: { c: 'float', ts: 'MetresPerSecondSquared' },
  CubicMetresPerSecond: { c: 'float', ts: 'CubicMetresPerSecond' },
  Kilograms: { c: 'float', ts: 'Kilograms' },
  CubicMetres: { c: 'float', ts: 'CubicMetres' },
  SquareMetres: { c: 'float', ts: 'SquareMetres' },
  PerSecond: { c: 'float', ts: 'PerSecond' },
  Radians: { c: 'float', ts: 'Radians' },
};
/** Returns: C type of the export, C type of the implementation, TS type. */
const RETURNS = {
  Void: { c: 'void', ts: 'void' },
  I32: { c: 'int', ts: 'number' },
  Status: { c: 'int', ts: 'WsStatus' },
  Seconds: { c: 'float', ts: 'Seconds' },
  PtrF32: { c: 'uintptr_t', ts: 'Ptr<F32>' },
  PtrSoA: { c: 'uintptr_t', ts: 'Ptr<ParticleSoA>' },
};
/** The wasmUnits.ts names a set of TS types mention ('Ptr<F32>' -> Ptr, F32). */
const brandsIn = (types) => [...new Set(types.flatMap((t) => t.match(/\b[A-Z]\w*/g) ?? []))].sort();

const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const LINE = {
  version: /^WS_ABI_VERSION\((\d+)\)$/,
  constant: new RegExp(String.raw`^WS_CONST\((int|float),\s*(\w+),\s*([-\d.e]+),\s*${STR}\)$`),
  struct: new RegExp(String.raw`^WS_STRUCT\((\w+),\s*${STR}\)$`),
  field: new RegExp(String.raw`^WS_FIELD\((\w+),\s*(\w+),\s*${STR}\)$`),
  fn: /^WS_FN\((\w+(?:\(\w+\))?),\s*(\w+),\s*([\w.]+)\)$/,
  doc: new RegExp(String.raw`^WS_DOC\(${STR}\)$`),
  arg: new RegExp(String.raw`^WS_ARG\((\w+),\s*(\w+),\s*${STR}\)$`),
  end: /^WS_END\(\)$/,
};

/** abi.def → { version, constants, structs, fns }. Throws with file:line on anything it does not know. */
export function parseDef(text) {
  const model = { version: 0, constants: [], structs: [], fns: [] };
  let open = null;
  const lines = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')).split('\n');
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const fail = (why) => { throw new Error(`abi.def:${i + 1}: ${why}: ${line}`); };
    let m;
    if ((m = LINE.version.exec(line))) model.version = Number(m[1]);
    else if ((m = LINE.constant.exec(line))) model.constants.push({ type: m[1], name: m[2], value: Number(m[3]), doc: m[4] });
    else if ((m = LINE.struct.exec(line))) {
      if (open) fail('WS_STRUCT inside an open entry');
      open = { struct: true, name: m[1], doc: m[2], fields: [] };
    } else if ((m = LINE.field.exec(line))) {
      if (!open?.struct) fail('WS_FIELD outside WS_STRUCT');
      if (!KINDS[m[1]] || KINDS[m[1]].c !== 'float') fail(`field kind must be a float kind, got ${m[1]}`);
      open.fields.push({ kind: m[1], name: m[2], doc: m[3] });
    } else if ((m = LINE.fn.exec(line))) {
      if (open) fail('WS_FN inside an open entry');
      const out = /^Out\((\w+)\)$/.exec(m[1]);
      if (!out && !RETURNS[m[1]]) fail(`unknown return ${m[1]}`);
      open = { name: m[2], returns: m[1], outStruct: out?.[1] ?? null, header: m[3], doc: [], args: [] };
    } else if ((m = LINE.doc.exec(line))) {
      if (!open || open.struct) fail('WS_DOC outside WS_FN');
      open.doc.push(m[1]);
    } else if ((m = LINE.arg.exec(line))) {
      if (!open || open.struct) fail('WS_ARG outside WS_FN');
      if (!KINDS[m[1]]) fail(`unknown kind ${m[1]}`);
      open.args.push({ kind: m[1], name: m[2], doc: m[3] });
    } else if (LINE.end.test(line)) {
      if (!open) fail('WS_END with nothing open');
      (open.struct ? model.structs : model.fns).push(open);
      open = null;
    } else fail('not an abi.def entry');
  });
  if (open) throw new Error(`abi.def: ${open.name} is not closed with WS_END()`);
  if (!model.version) throw new Error('abi.def: no WS_ABI_VERSION');
  for (const fn of model.fns) {
    if (fn.outStruct && !model.structs.some((s) => s.name === fn.outStruct)) {
      throw new Error(`abi.def: ${fn.name} returns Out(${fn.outStruct}), which has no WS_STRUCT`);
    }
    const outs = fn.args.filter((a) => a.kind === 'OutU32');
    if (outs.length > 1 || (outs.length === 1 && (fn.returns !== 'Status' || fn.args.at(-1) !== outs[0]))) {
      throw new Error(`abi.def: ${fn.name}: one OutU32, last, on a Status export`);
    }
    if (outs.length === 1 && !fn.args.some((a) => `${a.name}Out` === outs[0].name)) {
      throw new Error(`abi.def: ${fn.name}: ${outs[0].name} needs an argument ${outs[0].name.slice(0, -3)} to fall back to`);
    }
  }
  return model;
}

const GENERATED = 'GENERATED by scripts/gen-abi.mjs from emscripten/abi.def — do not edit (pnpm gen:abi).';
const cLiteral = (c) => (c.type === 'float' ? `${Number.isInteger(c.value) ? c.value.toFixed(1) : c.value}f` : String(c.value));
const cParams = (fn) => fn.args.map((a) => `${KINDS[a.kind].c} ${a.name}`);
const implReturn = (fn) => fn.outStruct ?? RETURNS[fn.returns].c;

export function emitHeader(model) {
  const out = [
    `// ${GENERATED}`,
    '// Checked by gen-abi --check in pnpm typecheck and in every CMake build.',
    '#ifndef WATERSHED_ABI_GENERATED_H',
    '#define WATERSHED_ABI_GENERATED_H',
    '',
    '/** ws_getVersion(); the loader requires exactly this number (wasmAbi.generated.ts WASM_ABI_VERSION). */',
    `inline constexpr int WATERSHED_ABI_VERSION = ${model.version};`,
    '',
    ...model.constants.flatMap((c) => [`/** ${c.doc} */`, `inline constexpr ${c.type} ${c.name} = ${cLiteral(c)};`]),
    '',
    '#endif  // WATERSHED_ABI_GENERATED_H',
    '',
    '// The exports. Compiled into bindings.cpp only: it includes the implementation headers,',
    '// defines WS_EXPORT and writeOut, then WATERSHED_ABI_EXPORTS, and includes this file again.',
    '#if defined(WATERSHED_ABI_EXPORTS) && !defined(WATERSHED_ABI_EXPORTS_DONE)',
    '#define WATERSHED_ABI_EXPORTS_DONE',
  ];
  for (const s of model.structs) {
    out.push('', `static_assert(std::is_standard_layout_v<${s.name}> && sizeof(${s.name}) == ${s.fields.length} * sizeof(float),`,
      `              "${s.name} is written as ${s.fields.length} packed floats");`);
    s.fields.forEach((f, i) => out.push(`static_assert(offsetof(${s.name}, ${f.name}) == ${i} * sizeof(float), "${s.name}.${f.name} is float ${i}");`));
  }
  for (const fn of model.fns) {
    const params = cParams(fn);
    const call = `${fn.name}(${fn.args.map((a) => a.name).join(', ')})`;
    out.push('', `/** ${fn.doc.join(' ')} */`);
    if (fn.header === 'abi') {
      out.push(`WS_EXPORT int ws_${fn.name}() noexcept {`, '    return WATERSHED_ABI_VERSION;', '}');
    } else if (fn.outStruct) {
      out.push(`WS_EXPORT void ws_${fn.name}(${[...params, 'uintptr_t outPtr'].join(', ')}) noexcept {`,
        `    writeOut(outPtr, ${call});`, '}');
    } else {
      const ret = RETURNS[fn.returns].c;
      out.push(`WS_EXPORT ${ret} ws_${fn.name}(${params.join(', ') || 'void'}) noexcept {`,
        `    ${ret === 'void' ? '' : 'return '}${call};`, '}');
    }
  }
  out.push('', '#endif  // WATERSHED_ABI_EXPORTS', '');
  return out.join('\n');
}

const tsDoc = (lines, indent = '') => (lines.length === 0 ? [] : lines.length === 1
  ? [`${indent}/** ${lines[0]} */`]
  : [`${indent}/**`, ...lines.map((l) => `${indent} * ${l}`.trimEnd()), `${indent} */`]);
const tsArgs = (fn) => fn.args.filter((a) => KINDS[a.kind].ts !== null);
const folds = (fn) => fn.args.some((a) => a.kind === 'OutU32');
function tsReturn(fn) {
  if (fn.outStruct) return fn.outStruct;
  if (folds(fn)) return 'number';
  return RETURNS[fn.returns].ts;
}

export function emitTs(model) {
  const out = [
    `// ${GENERATED}`,
    '// The hand-written half (bindNativeModule, heap helpers) is wasmAbi.ts.',
    `import type { ${brandsIn(model.fns.flatMap((fn) => [...tsArgs(fn).map((a) => KINDS[a.kind].ts), tsReturn(fn)]))
      .filter((b) => !model.structs.some((st) => st.name === b)).join(', ')} } from './wasmUnits';`,
    '',
    '/** ws_getVersion() of the binary this table describes; the loader requires exactly this. */',
    `export const WASM_ABI_VERSION = ${model.version};`,
    '',
    ...model.constants.flatMap((c) => [`/** ${c.doc} */`, `export const ${c.name} = ${c.value};`]),
  ];
  for (const s of model.structs) {
    out.push('', `/** ${s.doc} */`, `export interface ${s.name} {`);
    for (const f of s.fields) out.push(`  /** ${f.doc} */`, `  ${f.name}: number;`);
    out.push('}');
  }
  out.push('', '/** Every ws_* export, as the bound module exposes it. Brands are erased: plain numbers pass. */',
    'export interface WatershedNativeExports {');
  for (const fn of model.fns) {
    const docs = [...fn.doc];
    const args = tsArgs(fn);
    const params = args.filter((a) => a.doc).map((a) => `@param ${a.name} ${a.doc}`);
    if (params.length) docs.push('', ...params);
    if (folds(fn)) docs.push('', `@returns the out value, or \`${fn.args.find((a) => `${a.name}Out` === fn.args.at(-1).name).name}\` when refused (warned once in dev)`);
    out.push(...tsDoc(docs, '  '), `  ${fn.name}(${args.map((a) => `${a.name}: ${KINDS[a.kind].ts}`).join(', ')}): ${tsReturn(fn)};`);
  }
  out.push('}', '',
    'export type WasmAbiFunctionName = keyof WatershedNativeExports;',
    '',
    '/** The heap an out-pointer reader reads; `at` is the out block as a float index (ptr >>> 2). */',
    'export type OutReader = (heap: { HEAPF32: Float32Array; HEAP32: Int32Array }, at: number) => unknown;',
    '',
    'export interface WasmAbiEntry {',
    '  /** Parameter count of `ws_<name>`, the trailing out-pointer included. */',
    '  readonly arity: number;',
    '  /** Floats written through the trailing out-pointer, and how to read them back. */',
    '  readonly out?: { readonly floats: number; readonly read: OutReader };',
    '  /** A Status export whose TS face returns the out value: the argument index returned when refused. */',
    '  readonly fold?: number;',
    '}',
  );
  for (const s of model.structs) {
    out.push('', `const read${s.name}: OutReader = (heap, at) => ({`,
      ...s.fields.map((f, i) => `  ${f.name}: heap.HEAPF32[at${i ? ` + ${i}` : ''}],`), `}) satisfies ${s.name};`);
  }
  if (model.fns.some(folds)) out.push('', 'const readU32: OutReader = (heap, at) => heap.HEAP32[at] >>> 0;');
  out.push('', '/** Every export of the module, keyed by its TS name; the C symbol is `ws_<name>`. */', 'export const WASM_ABI = {');
  for (const fn of model.fns) {
    const arity = fn.args.length + (fn.outStruct ? 1 : 0);
    const parts = [`arity: ${arity}`];
    if (fn.outStruct) {
      const s = model.structs.find((x) => x.name === fn.outStruct);
      parts.push(`out: { floats: ${s.fields.length}, read: read${s.name} }`);
    }
    if (folds(fn)) {
      const fallback = fn.args.at(-1).name.slice(0, -3);
      parts.push('out: { floats: 1, read: readU32 }', `fold: ${tsArgs(fn).findIndex((a) => a.name === fallback)}`);
    }
    out.push(`  ${fn.name}: { ${parts.join(', ')} },`);
  }
  out.push('} as const satisfies Record<WasmAbiFunctionName, WasmAbiEntry>;', '');
  return out.join('\n');
}

function mdTable(model) {
  const rows = model.fns.map((fn) => {
    const args = fn.args.map((a) => `${a.name}: ${a.kind}`).join(', ');
    const ret = fn.outStruct ? `void (writes \`${fn.outStruct}\`)` : RETURNS[fn.returns].c === 'void' ? 'void' : fn.returns;
    const header = fn.header === 'abi' ? '—' : `\`${fn.header}\``;
    return `| \`ws_${fn.name}\` | ${args || '—'} | ${ret} | ${header} |`;
  });
  return [MD_BEGIN, '', `ABI **${model.version}**: ${model.fns.length} exports.`, '',
    '| Export | Parameters (kind) | Returns | Implementation |', '|---|---|---|---|', ...rows, '', MD_END].join('\n');
}

export function emitMd(model, current) {
  const a = current.indexOf(MD_BEGIN);
  const b = current.indexOf(MD_END);
  if (a < 0 || b < a) throw new Error('WASM.md: no gen-abi markers (restore them around the export table)');
  return current.slice(0, a) + mdTable(model) + current.slice(b + MD_END.length);
}

/**
 * Each implementation prototype, read out of its header: same return, same C
 * parameter types, same names, same order as abi.def. A forwarder that
 * compiled could still pass `dt` where the implementation reads `inflowQ`;
 * this is what makes that a red build.
 */
export function checkImplementations(model, readHeader = (h) => readFileSync(join(root, 'emscripten', h), 'utf8')) {
  const problems = [];
  for (const fn of model.fns) {
    if (fn.header === 'abi') continue;
    const text = readHeader(fn.header).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const re = new RegExp(String.raw`(?:^|[;}\n])\s*(?:\[\[nodiscard\]\]\s*)?([A-Za-z_][\w:]*)\s+${fn.name}\s*\(([^)]*)\)\s*(?:noexcept\s*)?;`, 'g');
    const found = [...text.matchAll(re)];
    if (found.length !== 1) {
      problems.push(`${fn.header}: expected one prototype of ${fn.name}, found ${found.length}`);
      continue;
    }
    const [, ret, list] = found[0];
    const params = list.split(',').map((p) => p.trim().replace(/\s+/g, ' ')).filter((p) => p && p !== 'void');
    const want = cParams(fn);
    if (ret !== implReturn(fn)) problems.push(`${fn.header}: ${fn.name} returns ${ret}, abi.def says ${implReturn(fn)}`);
    if (params.join(', ') !== want.join(', ')) {
      problems.push(`${fn.header}: ${fn.name}(${params.join(', ')})\n    abi.def: ${fn.name}(${want.join(', ')})`);
    }
  }
  return problems;
}

/** Everything --check verifies, as a list of problems (empty = in sync). */
export function checkAbi() {
  const model = parseDef(readFileSync(DEF, 'utf8'));
  const problems = checkImplementations(model);
  const expect = {
    header: emitHeader(model),
    ts: emitTs(model),
    md: emitMd(model, readFileSync(OUTPUTS.md, 'utf8')),
  };
  for (const [key, text] of Object.entries(expect)) {
    let current = '';
    try { current = readFileSync(OUTPUTS[key], 'utf8'); } catch { /* missing = stale */ }
    if (current !== text) problems.push(`${OUTPUTS[key].slice(root.length + 1)} is stale: run pnpm gen:abi`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const problems = checkAbi();
    if (problems.length) {
      console.error(`[gen-abi] emscripten/abi.def is not what the code says:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log('[gen-abi] abi.def, its headers and the generated files agree');
  } else {
    const model = parseDef(readFileSync(DEF, 'utf8'));
    writeFileSync(OUTPUTS.header, emitHeader(model));
    writeFileSync(OUTPUTS.ts, emitTs(model));
    writeFileSync(OUTPUTS.md, emitMd(model, readFileSync(OUTPUTS.md, 'utf8')));
    const problems = checkImplementations(model);
    if (problems.length) {
      console.error(`[gen-abi] wrote the files, but the headers disagree:\n  ${problems.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`[gen-abi] ABI ${model.version}: ${model.fns.length} exports`);
  }
}
