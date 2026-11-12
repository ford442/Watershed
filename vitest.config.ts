import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

const rootDir = dirname(fileURLToPath(import.meta.url));
const threeWebgpuMock = resolve(rootDir, 'src/rendering/__mocks__/threeWebgpu.ts');

/** Wall-time and heap budgets: `*.perf.test.ts(x)`, run by `pnpm test:perf` only. */
const PERF_TESTS = 'src/**/*.perf.test.{ts,tsx}';

/**
 * The headless campaign (#556 B): whole runs through SimCore, Rapier and the
 * shipped WASM in Node, no DOM. `pnpm test:campaign` only — a run is seconds,
 * not milliseconds, so it has its own CI job and stays out of `pnpm test`.
 */
const CAMPAIGN_TESTS = 'src/**/*.campaign.test.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      server: {
        deps: {
          // The emscripten glue loads as Node loads it, untransformed: Vite's
          // web transform rewrites its `new URL('./', import.meta.url)` to an
          // http:// URL, which the Debug glue (built for node too) rejects.
          external: [/watershed_native\.js$/],
        },
      },
      alias: {
        'three/webgpu': threeWebgpuMock,
        'three/tsl': threeWebgpuMock,
      },
      projects: [
        {
          extends: true,
          test: {
            // `pnpm test`: behaviour only. No assertion here may depend on how
            // fast the box is; the generous timeouts are runaway guards, not
            // budgets (a loaded 8-core box timed out 24 tests at the 5 s default).
            name: 'unit',
            // ./emsdk is the repo-local pinned toolchain (scripts/emsdk-pinned.sh); its own tests are not ours.
            exclude: [...configDefaults.exclude, 'emsdk/**', '.claude/**', PERF_TESTS, CAMPAIGN_TESTS],
            testTimeout: 30_000,
            hookTimeout: 30_000,
          },
        },
        {
          extends: true,
          test: {
            // `pnpm test:campaign`: Node, not jsdom — the harness must not lean on a DOM
            // (that is the point of it), so a stray `window` read fails here.
            name: 'campaign',
            include: [CAMPAIGN_TESTS],
            environment: 'node',
            setupFiles: [],
            // A whole campaign map is seconds of CPU; these are runaway guards, not budgets.
            testTimeout: 180_000,
            hookTimeout: 60_000,
          },
        },
        {
          extends: true,
          test: {
            // `pnpm test:perf`: budgets, in their own CI step. A budget that
            // misses once on a noisy runner gets two more tries.
            name: 'perf',
            include: [PERF_TESTS],
            retry: 2,
          },
        },
      ],
    },
  }),
);
