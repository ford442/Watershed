#!/usr/bin/env node
/**
 * compile-validators.mjs — precompile the JSON-Schema validators (#485 C).
 *
 * `levelValidator.ts` / `reachValidator.ts` used to build an `Ajv` instance (plus
 * `ajv-formats`, plus `fast-uri`) in the player's browser just to compile two schemas
 * this repo authors. This is the dev-time half: it turns each schema into a
 * self-contained ES module with `ajv/dist/standalone`, checked in next to the schema:
 *
 *   src/formats/level.schema.json -> src/formats/level.validate.js (+ .d.ts)
 *   src/formats/reach.schema.json -> src/formats/reach.validate.js (+ .d.ts)
 *
 * `ajv` is a devDependency (this script + the drift tests); nothing under src/ imports it.
 *
 *   node scripts/compile-validators.mjs           # (re)write the checked-in files
 *   node scripts/compile-validators.mjs --check   # exit 1 if a checked-in file is stale
 *
 * `src/formats/validators.drift.test.ts` runs the same comparison under `pnpm test`, so a
 * schema edit without a regeneration fails CI.
 *
 * Options mirror what the runtime used (`allErrors`, strict mode) except the size trims below.
 * Every kB here is in the boot entry (both validators are reachable from src/index.tsx), so
 * the generated code is trimmed of what no caller reads, ~54 kB minified for the pair:
 *
 *   - `verbose` off: it attaches `data`/`schema`/`parentSchema` to every error (~48 kB per
 *     validator). The one thing callers read from it, `err.data`, is recovered from
 *     `instancePath` by `valueAtPointer`.
 *   - `schemaPath` blanked (`""`): ~390 long unique strings per validator, ~25 kB minified
 *     each. Nothing reads it; `instancePath`, `keyword`, `params` and `message` are untouched.
 *   - annotation text (`description` / `title` / `$comment` / `examples`) removed from the
 *     schema before compiling: it has no effect on validation but the standalone code embeds
 *     the whole schema object (`params.allowedValues` reads from it).
 *
 * `validators.drift.test.ts` pins all of it: verdicts and every error field except
 * `schemaPath` equal a verbose ajv on the full schema, over authored and mutated documents.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORMATS_DIR = path.join(REPO_ROOT, 'src/formats');

/** Schemas compiled into the runtime graph. persistence.schema.json is deliberately
 *  absent: PersistenceSystem validates its own tiny shape with a hand-written guard. */
export const VALIDATORS = ['level', 'reach'];

/** The only ajv runtime helper the generated code calls for these schemas
 *  (`minLength` / `maxLength`), inlined so the output has no import at all. Any other
 *  `require(...)` in the output means a schema started using a feature that needs more
 *  (formats, uniqueItems on objects, ...): fail loudly rather than ship a broken file. */
const INLINED_HELPERS = {
  'ajv/dist/runtime/ucs2length': `function ucs2length(str) {
  const len = str.length;
  let length = 0;
  let pos = 0;
  let value;
  while (pos < len) {
    length++;
    value = str.charCodeAt(pos++);
    if (value >= 0xd800 && value <= 0xdbff && pos < len) {
      value = str.charCodeAt(pos);
      if ((value & 0xfc00) === 0xdc00) pos++;
    }
  }
  return length;
}`,
};

/** Annotation keywords whose string/array value never affects validation. A *property* that
 *  happens to be named `description` has an object value and is therefore kept. */
const ANNOTATIONS = ['description', 'title', '$comment', 'examples'];
function stripAnnotations(node) {
  if (Array.isArray(node)) return node.map(stripAnnotations);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    const isAnnotation = ANNOTATIONS.includes(key) && (typeof value === 'string' || Array.isArray(value));
    if (!isAnnotation) out[key] = stripAnnotations(value);
  }
  return out;
}

export function schemaPath(name) {
  return path.join(FORMATS_DIR, `${name}.schema.json`);
}
export function outputPaths(name) {
  return {
    js: path.join(FORMATS_DIR, `${name}.validate.js`),
    dts: path.join(FORMATS_DIR, `${name}.validate.d.ts`),
  };
}

/** Pure: schema file text in, generated { js, dts } text out. Deterministic. */
export function generateValidator(name, schemaText = fs.readFileSync(schemaPath(name), 'utf8')) {
  const schema = stripAnnotations(JSON.parse(schemaText));
  const ajv = new Ajv({ allErrors: true, verbose: false, code: { source: true, esm: true } });
  let code = standaloneCode(ajv, ajv.compile(schema));

  let blanked = 0;
  code = code.replace(/schemaPath:"[^"]*"/g, () => {
    blanked += 1;
    return 'schemaPath:""';
  });
  if (blanked === 0 || /schemaPath:(?!"")/.test(code)) {
    throw new Error(`compile-validators: ${name}: the generated code no longer has literal schemaPath strings only; re-audit the trim`);
  }

  const needed = new Set();
  code = code.replace(/require\("([^"]+)"\)\.default/g, (match, id) => {
    if (!(id in INLINED_HELPERS)) {
      throw new Error(
        `compile-validators: ${name}.schema.json needs the ajv runtime helper "${id}", which this ` +
          'script does not inline. Add it to INLINED_HELPERS (or avoid the keyword).',
      );
    }
    needed.add(id);
    return INLINED_HELPERS[id].match(/function (\w+)/)[1];
  });
  const leftover = code.match(/\brequire\(/);
  if (leftover) throw new Error(`compile-validators: ${name}: unresolved require() left in the output`);

  const sha = createHash('sha256').update(schemaText).digest('hex').slice(0, 16);
  const helpers = [...needed].map((id) => INLINED_HELPERS[id]).join('\n');
  const js =
    `// @ts-nocheck\n` +
    `// GENERATED by scripts/compile-validators.mjs from ${name}.schema.json (sha256 ${sha}).\n` +
    `// Do not edit. Regenerate with \`pnpm compile:validators\`; \`pnpm test\` fails if this is stale.\n` +
    `${helpers ? `${helpers}\n` : ''}${code}\n`;

  const dts =
    `// GENERATED by scripts/compile-validators.mjs from ${name}.schema.json (sha256 ${sha}). Do not edit.\n` +
    `export interface SchemaValidationError {\n` +
    `  instancePath: string;\n` +
    `  /** Always "" — stripped from the generated code to save ~25 kB per validator. */\n` +
    `  schemaPath: string;\n` +
    `  keyword: string;\n` +
    `  params: Record<string, unknown>;\n` +
    `  message?: string;\n` +
    `  propertyName?: string;\n` +
    `}\n` +
    `export interface SchemaValidateFunction {\n` +
    `  (data: unknown): boolean;\n` +
    `  errors?: SchemaValidationError[] | null;\n` +
    `}\n` +
    `export declare const validate: SchemaValidateFunction;\n` +
    `export default validate;\n`;
  return { js, dts };
}

function main() {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const name of VALIDATORS) {
    const { js, dts } = generateValidator(name);
    const out = outputPaths(name);
    for (const [file, text] of [[out.js, js], [out.dts, dts]]) {
      const rel = path.relative(REPO_ROOT, file);
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (check) {
        if (current !== text) {
          stale += 1;
          process.stderr.write(`stale: ${rel}\n`);
        }
      } else if (current !== text) {
        fs.writeFileSync(file, text, 'utf8');
        process.stdout.write(`wrote ${rel} (${text.length} bytes)\n`);
      } else {
        process.stdout.write(`unchanged ${rel}\n`);
      }
    }
  }
  if (check && stale > 0) {
    process.stderr.write('run `pnpm compile:validators` and commit the result\n');
    process.exit(1);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
