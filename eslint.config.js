/**
 * ESLint flat config.
 *
 * This project shipped for months with "run the linter" in its tooling prompts
 * and no `lint` script behind it — every one of those steps was a silent no-op.
 * This config is the answer to that: `pnpm lint` is real, it is green, and CI
 * can gate on it.
 *
 * The rule set is deliberately narrow. A large existing codebase cannot absorb
 * a full recommended set in one pass without either a mechanical rewrite or a
 * wall of inline disables, and both make the linter something people route
 * around. So: keep every rule that catches a *bug*, turn off the ones that only
 * express a style preference this codebase has already made, and write down why
 * — an unexplained `off` is how a rule set rots.
 *
 * Tightening any of these is welcome as its own PR, with the fixes in it.
 */
import { readFileSync } from 'node:fs';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import r3f from '@react-three/eslint-plugin';

/**
 * Game event names, read from the one typed bus (#503 C) so this rule and
 * `GameEventMap` cannot drift. `weather-update` is the retired event that
 * became the store's `weather` field.
 */
const GAME_EVENT_NAMES = [
  ...readFileSync(new URL('./src/systems/events/GameEvents.ts', import.meta.url), 'utf8')
    .match(/export interface GameEventMap \{([\s\S]*?)\n\}/)[1]
    .matchAll(/^\s+'?([\w-]+)'?:/gm),
].map((m) => m[1]).concat('weather-update');

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      'emscripten/**',
      // Repo-local pinned toolchain (scripts/emsdk-pinned.sh), git-ignored.
      'emsdk/**',
      'public/**',
      'verification/output/**',
      'coverage/**',
      'docs/**',
    ],
  },

  // ---------------------------------------------------------------------------
  // Application + test sources
  // ---------------------------------------------------------------------------
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks, '@react-three': r3f },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2025 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // TypeScript itself resolves identifiers; `no-undef` in a TS file only
      // produces false positives for types and ambient globals.
      'no-undef': 'off',

      // --- kept, because they catch real defects ---------------------------
      // Hook order and stale-closure bugs are the single most common React
      // failure mode in this codebase's frame-driven components.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // --- warnings: a real backlog, not a style opinion --------------------
      // R3F's allocation rules are the right rules — `new`/`.clone()` inside a
      // useFrame body is a per-frame GC hazard in a 60 FPS game. There are ~110
      // pre-existing sites, and each needs a hoisted scratch object rather than
      // a mechanical rewrite, so they land as warnings: visible, counted, not
      // gating. Promoting them to `error` is its own PR, with the fixes in it.
      ...Object.fromEntries(
        Object.keys(r3f.configs.recommended.rules).map((rule) => [rule, 'warn']),
      ),
      // Flags defensive initialisers that are overwritten on every path
      // (`let x = fallback` before a switch that always assigns). Mostly noise
      // against this codebase's style — but it also found a genuine dead
      // fallback in AudioSystem.getFootstepSound, so it stays visible.
      'no-useless-assignment': 'warn',
      'no-constant-binary-expression': 'warn',
      // `Function` as a parameter type appears where Rapier's compat surface is
      // being structurally typed. Worth replacing; not worth blocking on.
      '@typescript-eslint/no-unsafe-function-type': 'warn',

      // --- turned off, with the reason -------------------------------------
      // `any` is load-bearing here: Rapier's compat types, R3F's `extend`d
      // elements, and the WASM glue are all typed loosely on purpose. Banning
      // it would produce hundreds of `unknown` casts, not more safety.
      '@typescript-eslint/no-explicit-any': 'off',
      // Empty catch blocks are a deliberate pattern in the storage/probe paths
      // ("best effort, degrade quietly"), and each one carries a comment.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // TS's own checker already reports unused locals where it matters, and
      // the leading-underscore convention is used throughout for intentional
      // ones (`_exhaustive`, unused effect args).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Namespaces appear only in ambient R3F/three module augmentation.
      '@typescript-eslint/no-namespace': 'off',
      // `!` is used against three/Rapier APIs that are non-null by construction
      // but typed optional.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `require` shows up in vi.mock factories, where ESM imports are hoisted
      // out from under the mock.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Game events go through `gameEvents` (src/systems/events/GameEvents.ts), not
  // `window` — typed payloads, one map of who sends what, no orphan events.
  // The query string goes through src/config/queryFlags.ts (#521 E): one parse,
  // one grammar for boolean flags (`1` | `true`), one writer.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/systems/events/GameEvents.ts',
      'src/config/queryFlags.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name='dispatchEvent']",
          message: 'Emit game events with gameEvents.emit (src/systems/events/GameEvents.ts), not window.dispatchEvent.',
        },
        {
          selector: `CallExpression[callee.property.name=/^(add|remove)EventListener$/][arguments.0.value=/^(${GAME_EVENT_NAMES.join('|')})$/]`,
          message: 'Listen to game events with gameEvents.on (src/systems/events/GameEvents.ts), not addEventListener.',
        },
        {
          selector: "MemberExpression[property.name='search'][object.name='location'], MemberExpression[property.name='search'][object.property.name='location']",
          message: 'Read the query string through src/config/queryFlags.ts (queryFlags / queryParam / currentSearch).',
        },
      ],
    },
  },

  // Sim time (#518 B). Gameplay runs on the frame delta / R3F's clock, never the
  // wall clock: a scripted run, a replay or a ghost must give the same splits
  // on a laptop, on CI and on a box under load. The input smoke used to find
  // these a week after the merge; this rule finds them at the keyboard.
  // Wall-clock reads that are not sim state go through src/utils/wallClock.ts
  // (metadata stamps, telemetry). The allowlist below is the rest, each with
  // its reason; adding to it needs one too.
  {
    files: [
      'src/systems/**/*.{ts,tsx}',
      'src/vehicles/**/*.{ts,tsx}',
      'src/physics/**/*.{ts,tsx}',
      'src/sim/**/*.{ts,tsx}',
      'src/components/Obstacles/**/*.{ts,tsx}',
    ],
    ignores: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'src/**/__tests__/**',
      'src/**/__mocks__/**',
      // Storage: debounced localStorage writes (I/O pacing, not sim state).
      'src/systems/persistence/**',
      // Audio: fades and idle preload scheduling are presentation.
      'src/systems/audio/AudioSystem.ts',
      // Render-quality telemetry: frame-time sampling for adaptive LOD, which
      // is off on a scripted / replay page (LODManager: isScriptedInputMode).
      'src/systems/lod/LODManager.tsx',
      // Loader: the native-module init timeout.
      'src/systems/water/wasmLoader.ts',
      // Diagnostic: the dev-only WGSL ↔ WASM parity page waits on GPU readback.
      'src/systems/water/sweParity.ts',
    ],
    rules: {
      // Zero steady-state allocation on the sim / frame path (#521 D): a `new`
      // or `.clone()` inside useFrame is an error here, not a warning.
      '@react-three/no-new-in-loop': 'error',
      '@react-three/no-clone-in-loop': 'error',
      'no-restricted-globals': [
        'error',
        ...['setTimeout', 'setInterval', 'requestAnimationFrame'].map((name) => ({
          name,
          message: `${name} paces gameplay by wall time. Count sim seconds from the frame delta (useFrame / update(dt)) instead.`,
        })),
      ],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          ['setTimeout', 'setInterval', 'requestAnimationFrame'].map((property) => ({
            object,
            property,
            message: `${object}.${property} paces gameplay by wall time. Count sim seconds from the frame delta instead.`,
          })),
        ),
        {
          object: 'performance',
          property: 'now',
          message: 'Sim code runs on sim time (frame delta / R3F clock). Telemetry: telemetryNowMs() from src/utils/wallClock.ts.',
        },
        {
          object: 'Date',
          property: 'now',
          message: 'Sim code runs on sim time (frame delta / R3F clock). Metadata stamps: wallClockEpochMs() from src/utils/wallClock.ts.',
        },
      ],
    },
  },

  // Vitest globals (`describe`/`it`/`expect`/`vi`) — `globals: true` in the
  // vitest config, so there are no imports for the linter to see.
  {
    files: ['**/*.{test,spec}.{js,mjs,ts,tsx}', 'src/setupTests.ts'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Node-side tooling: build scripts, the visual-smoke harness, config files
  // ---------------------------------------------------------------------------
  {
    files: ['scripts/**/*.mjs', 'verification/**/*.{mjs,cjs}', '*.config.{js,ts}', '*.config.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      // Node *and* browser: the puppeteer harnesses run half their code inside
      // `page.evaluate()`, where `window` and `document` are the real globals.
      globals: { ...globals.node, ...globals.browser },
      sourceType: 'module',
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-useless-assignment': 'warn',
    },
  },
);
