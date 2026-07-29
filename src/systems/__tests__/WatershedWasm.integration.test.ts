/**
 * WatershedWasm.integration.test.ts
 *
 * CI runs the real binary through emscripten/smoke_test.mjs and asserts the
 * artifact size budget here. Runtime API checks stay in the Node smoke script
 * because the browser-oriented Emscripten glue requires instantiateWasm in Node.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(rootDir, '../../../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const smokeScript = resolve(rootDir, '../../../emscripten/smoke_test.mjs');
const runIntegration = process.env.WATERSHED_WASM_INTEGRATION === '1' && existsSync(wasmPath);

const describeIntegration = runIntegration ? describe : describe.skip;

describeIntegration('WatershedWasm — real binary integration', () => {
  it('executes emscripten/smoke_test.mjs against the compiled module', () => {
    const output = execFileSync(process.execPath, [smokeScript], {
      encoding: 'utf8',
      env: process.env,
    });
    expect(output).toContain('watershed_native smoke ok');
  });

  it('keeps the WASM artifact under the CI size budget', () => {
    const wasmBytes = readFileSync(wasmPath).length;
    const maxBytes = Number(process.env.WATERSHED_WASM_MAX_BYTES ?? 131072);
    expect(wasmBytes).toBeGreaterThan(1024);
    expect(wasmBytes).toBeLessThan(maxBytes);
  });
});
