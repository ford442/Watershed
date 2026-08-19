/**
 * Water-force parity — C++ (emscripten/forces.cpp) vs TypeScript fallback.
 *
 * The worker path runs native math by default and silently degrades to the TS
 * fallback when watershed_native.wasm can't load, so the two implementations
 * have to agree or the raft would feel different depending on asset delivery.
 *
 * Default run (`pnpm test`): pins the TS fallback to committed expectations, so
 * an edit to either implementation that forgets the other shows up as a diff.
 * Native run (`pnpm test:wasm:parity`, needs a built module): additionally loads
 * watershed_native and asserts native ≈ TS within a float epsilon.
 */

import {
  calculateWaterForceFallback,
  createWaterForceBatch,
  getWasm,
  type NativeWaterForceResult,
  type WatershedNativeModule,
} from '../../systems/water/WatershedWasm';
import { WATER_FORCE_FIXTURES } from './waterForceFixtures';

/** Committed TS-fallback results, rounded to 4dp. Regenerate deliberately. */
const EXPECTED: NativeWaterForceResult[] = [
  {
    forceX: -239.3792,
    forceY: 11253.1309,
    forceZ: -1773.6646,
    buoyancy: 11767.98,
    drag: 608.65,
    flow: 2381.1375,
    turbulence: 0,
    submergedRatio: 1,
  },
  {
    forceX: 190.5538,
    forceY: 3645.2183,
    forceZ: 985.047,
    buoyancy: 4202.85,
    drag: 1169.4775,
    flow: 163.0312,
    turbulence: 0,
    submergedRatio: 0.3571,
  },
  {
    forceX: 0,
    forceY: 0,
    forceZ: 0,
    buoyancy: 0,
    drag: 0,
    flow: 0,
    turbulence: 0,
    submergedRatio: 0,
  },
  {
    forceX: 1243.1819,
    forceY: 11320.2592,
    forceZ: 8716.9467,
    buoyancy: 11767.98,
    drag: 9254.5233,
    flow: 3108.4578,
    turbulence: 0,
    submergedRatio: 1,
  },
  {
    forceX: 2665.0421,
    forceY: 10368.1811,
    forceZ: 19993.3916,
    buoyancy: 10927.41,
    drag: 17424.3453,
    flow: 2680.7625,
    turbulence: 111.4286,
    submergedRatio: 0.9286,
  },
  {
    forceX: -52.4518,
    forceY: 363.6016,
    forceZ: 1186.8619,
    buoyancy: 616.418,
    drag: 1012.6605,
    flow: 143.6384,
    turbulence: 58.9286,
    submergedRatio: 0.7857,
  },
];

const RESULT_KEYS = Object.keys(EXPECTED[0]) as (keyof NativeWaterForceResult)[];

/** Relative epsilon — float32 in C++ vs float64 in JS never matches bit-for-bit. */
const REL_EPSILON = 1e-3;

function expectClose(actual: number, expected: number, label: string): void {
  const tolerance = Math.max(Math.abs(expected) * REL_EPSILON, 1e-4);
  expect(
    Math.abs(actual - expected),
    `${label}: expected ${expected}, got ${actual}`,
  ).toBeLessThanOrEqual(tolerance);
}

describe('water-force fixtures — TypeScript fallback', () => {
  it('has one committed expectation per fixture', () => {
    expect(EXPECTED).toHaveLength(WATER_FORCE_FIXTURES.length);
  });

  WATER_FORCE_FIXTURES.forEach((fixture, index) => {
    it(`matches the committed result for: ${fixture.name}`, () => {
      const actual = calculateWaterForceFallback(fixture.sample, fixture.config);
      for (const key of RESULT_KEYS) {
        expectClose(actual[key], EXPECTED[index][key], `${fixture.name}.${key}`);
      }
    });
  });
});

// The native module is only present after `pnpm build:wasm`, so this block is
// opt-in via WATERSHED_WASM_INTEGRATION=1 exactly like the other WASM tests.
const runNative = process.env.WATERSHED_WASM_INTEGRATION === '1';
const describeNative = runNative ? describe : describe.skip;

describeNative('water-force parity — native C++ vs TypeScript', () => {
  let wasm: WatershedNativeModule;

  beforeAll(async () => {
    wasm = await getWasm();
  });

  it('exposes the expected ABI version', () => {
    expect(wasm.getVersion()).toBeGreaterThanOrEqual(4);
  });

  it('agrees with the TS fallback on every fixture (single-sample call)', () => {
    for (const fixture of WATER_FORCE_FIXTURES) {
      const { sample, config } = fixture;
      const native = wasm.calculateWaterForce(
        sample.position.x, sample.position.y, sample.position.z,
        sample.velocity.x, sample.velocity.y, sample.velocity.z,
        sample.flowDirection.x, sample.flowDirection.z,
        config.flowSpeed,
        config.waterLevel,
        config.raftMass,
        config.raftVolume,
        config.dragCoefficient,
        config.frontalArea,
        config.sideArea,
        config.timeSeconds,
        config.turbulenceStrength,
        config.turbulenceFrequency,
      );
      const fallback = calculateWaterForceFallback(sample, config);
      for (const key of RESULT_KEYS) {
        expectClose(native[key], fallback[key], `${fixture.name}.${key}`);
      }
    }
  });

  it('batched results match the single-sample path', () => {
    // All fixtures sharing one config so a single batch call covers them.
    const config = WATER_FORCE_FIXTURES[0].config;
    const batch = createWaterForceBatch(wasm, WATER_FORCE_FIXTURES.length);
    try {
      WATER_FORCE_FIXTURES.forEach((fixture, i) => batch.setSample(i, fixture.sample));
      batch.compute(config);

      WATER_FORCE_FIXTURES.forEach((fixture, i) => {
        const batched = batch.readResult(i);
        const fallback = calculateWaterForceFallback(fixture.sample, config);
        for (const key of RESULT_KEYS) {
          expectClose(batched[key], fallback[key], `batch[${i}].${key}`);
        }
      });
    } finally {
      batch.dispose();
    }
  });
});
