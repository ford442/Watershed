/**
 * The C++ stepper (emscripten/swe.cpp, common.h) and its WGSL twin
 * (swe.wgsl) are two hand-maintained HLL solvers. `pnpm test:wgsl` holds
 * their fields together at 1e-5 on a GPU; this holds the named constants
 * together on every `pnpm test`, without one. It does not generate either
 * file from the other — it only fails when one moves and the other did not.
 * The TS mirrors that sample or author against those constants are pinned too.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SWE_DRY_DEPTH } from './sampleSWEFlow';
import {
  HYDRO_BRAID_LATERAL,
  HYDRO_INFLOW_DOWNSTREAM,
  HYDRO_VORTEX_SINK,
} from './hydroEvents';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const sweCpp = readFileSync(resolve(root, 'emscripten/swe.cpp'), 'utf8');
const commonH = readFileSync(resolve(root, 'emscripten/common.h'), 'utf8');
const sweWgsl = readFileSync(resolve(here, 'swe.wgsl'), 'utf8');

const NUMBER = String.raw`([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)`;

/** `[static] [constexpr|const] float NAME = 1e-4f;` — the value, or a loud failure. */
function cppConstant(source: string, file: string, name: string): number {
  const match = new RegExp(String.raw`\bfloat\s+${name}\s*=\s*${NUMBER}f?\s*;`).exec(source);
  if (!match) throw new Error(`${file}: no float constant ${name} (renamed? update this map)`);
  return Number.parseFloat(match[1]);
}

/** `const NAME: f32 = 0.4;` */
function wgslConstant(name: string): number {
  const match = new RegExp(String.raw`\bconst\s+${name}\s*:\s*f32\s*=\s*${NUMBER}\s*;`).exec(sweWgsl);
  if (!match) throw new Error(`swe.wgsl: no f32 constant ${name} (renamed? update this map)`);
  return Number.parseFloat(match[1]);
}

/** C++ name (and file) ↔ WGSL name ↔ TS mirror, where one exists. */
const PAIRS: { cpp: string; file: 'swe.cpp' | 'common.h'; wgsl: string; ts?: number }[] = [
  { cpp: 'SWE_DRY_DEPTH', file: 'swe.cpp', wgsl: 'DRY_DEPTH', ts: SWE_DRY_DEPTH },
  { cpp: 'kCflNumber', file: 'swe.cpp', wgsl: 'CFL_NUMBER' },
  { cpp: 'DAMPING_COEFF', file: 'common.h', wgsl: 'DAMPING_COEFF' },
  { cpp: 'kHydroInflowDownstream', file: 'swe.cpp', wgsl: 'HYDRO_INFLOW_DOWNSTREAM', ts: HYDRO_INFLOW_DOWNSTREAM },
  { cpp: 'kHydroVortexSink', file: 'swe.cpp', wgsl: 'HYDRO_VORTEX_SINK', ts: HYDRO_VORTEX_SINK },
  { cpp: 'kHydroBraidLateral', file: 'swe.cpp', wgsl: 'HYDRO_BRAID_LATERAL', ts: HYDRO_BRAID_LATERAL },
];

describe('SWE solver constants: swe.cpp / common.h vs swe.wgsl', () => {
  it.each(PAIRS)('$cpp ($file) = $wgsl (swe.wgsl)', ({ cpp, file, wgsl, ts }) => {
    const native = cppConstant(file === 'swe.cpp' ? sweCpp : commonH, file, cpp);
    const twin = wgslConstant(wgsl);
    // Both sides are f32 literals: compare as the f32 each one compiles to.
    expect(Math.fround(twin), `${wgsl} drifted from ${cpp}`).toBe(Math.fround(native));
    if (ts !== undefined) expect(Math.fround(ts), `TS mirror of ${cpp}`).toBe(Math.fround(native));
  });

  it('dispatches the hydro event kinds in the same order (0 inflow, 1 vortex, 2 braid, 3 roughness)', () => {
    const kinds = (source: string, pattern: RegExp) => [...source.matchAll(pattern)].map((m) => Number(m[1]));
    expect(kinds(sweCpp, /\bkind\s*==\s*(\d)/g)).toEqual([0, 1, 2, 3]);
    expect(kinds(sweWgsl, /\bev\.kind\s*==\s*(\d)/g)).toEqual([0, 1, 2, 3]);
  });
});
