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
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import r3f from '@react-three/eslint-plugin';

export default tseslint.config(
  {
    ignores: [
      'build/**',
      'node_modules/**',
      'emscripten/**',
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
