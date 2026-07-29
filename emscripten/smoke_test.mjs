import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(scriptDir, '../public');
const wasmPath = resolve(publicDir, 'watershed_native.wasm');
const jsPath = pathToFileURL(resolve(publicDir, 'watershed_native.js')).href;
const wasmBinary = readFileSync(wasmPath);

if (!WebAssembly.validate(wasmBinary)) {
  throw new Error('watershed_native.wasm failed WebAssembly.validate');
}

const { default: createWatershedNative } = await import(jsPath);

const wasm = await createWatershedNative({
  instantiateWasm: (imports, receiveInstance) => {
    WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => {
      receiveInstance(instance);
    });
    return {};
  },
});

const buoyancy = wasm._calculateBuoyancyAndDrag(150, 0.4, 0, -3);

if (!Number.isFinite(buoyancy) || buoyancy <= 0) {
  throw new Error(`Unexpected _calculateBuoyancyAndDrag(): ${buoyancy}`);
}

console.log(`watershed_native smoke ok (buoyancy=${buoyancy.toFixed(2)})`);
