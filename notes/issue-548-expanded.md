**Expanded 2026-11-05 against `main` `ca10220`.** This merges three reviews (Gemini, gpt-oss-120b, Grok), each checked against the tree. The 11-04 draft was written against `e92ed98`. **PR #546 (`dc92063`, `eccf6fa`) has since landed most of it.** What follows is only the part that is left.

## Already on `main` (do not redo)
- **Validators are `.ts`.** `compile-validators.mjs` writes `src/formats/{level,reach}.validate.ts`. `allowJs` is gone and so is `scripts/untyped-allowlist.json`.
- **Results and predicates exist.** `validateLevel` / `validateReach` return `ValidationResult<T>` (`src/utils/validationReport.ts`), with `isLevelData` / `isReachManifest` predicates beside them. `ReachStreamer` uses `validation.data` and has no `any`.
- **ESLint is done.** `no-explicit-any` is `warn` with `off` overrides for `src/physics/**`, `src/systems/water/wasm*.ts`, `src/rendering/**` and tests. The stale `no-unsafe-function-type` rule is gone. CI runs `--max-warnings 18`.
- **The dual-material files are clean.** `createVfxMaterials.ts`, `createSkyMaterials.ts` and `createCritterMaterials.ts` have no `as unknown as`. No consumer casts the factory's `THREE.Material` return.
- **The cast count is already under target:** 38 non-test `any`-family sites (target ≤ 50, from 138).
- **Two of the six table tests exist:** `splashSpawnMath.test.ts` and `erosionCodec.test.ts`.

## Decisions (from the reviews, checked against the tree)
- **Keep ajv + `ValidationResult<T>` + the predicates. No Zod / Valibot / json-schema-to-ts.**
  - gpt-oss argued for Zod. That would add roughly 15 kB and a second schema source next to an ajv output that a drift test already pins.
  - The editor error panel, `useLevel` and `assertLevelData` all render `errors[]`.
  - Grok confirms ajv standalone still leads for compiled JSON Schema.
- **No `DualMaterialHandle` and no discriminated union.**
  - No caller casts any more.
  - `NodeMaterial extends Material` in r185–r187 (Grok).
  - `materialUniformBag` already probes `ShaderMaterial.uniforms` and then `userData.uniforms`. A union would force churn in about 13 consumers for no type gain.
- **`nodePostPipeline.ts` (8 casts) and `postNodeTypes.ts` are out.**
  - The `null` normal passed to `ao` / `denoise` is a real runtime argument: AO reconstructs normals from depth.
  - The file belongs to #534 E's rebuild.
- **The lint ratchet does not move (18).** New warnings get fixed.
- **`.wsriver` is in scope through `assertLevelData`. `.wsghost` and `PersistenceSystem` wait for #535 C.**
- **three 0.187 (out ~30 Oct) is not part of this.** It gets its own PR against the visual smokes, per #535 D.5.

## Work (one commit each)

### 1. `assertLevelData` returns the validated value
`src/maps/assertLevelData.ts:17` returns `raw as LevelData`. Return `result.data` instead. It is the same reference, because `validateLevel` does not clone, and `assertLevelData.test.ts` asserts `toBe`. Throw if `result.valid` is false and `filterUnexpectedLevelErrors` let it through. Leave `maps/registry.ts` `bundledLevel` as the cast so the registry never imports the validator.

### 2. `useLevel` carries `LevelData` on success, keeps the raw document on failure
- `LevelState.levelData: unknown` (`useLevel.ts:115, 135`) splits into two fields:
  - `levelData: LevelData | null`, set from `validationResult.data`;
  - `rawDocument: unknown`, the last input, which `reloadCurrent` re-feeds.
- On failure `levelData` is `null` and `rawDocument` keeps the invalid document, so reload still retries it.
- `normalizeLevelData`'s `config: seg as SegmentConfig` (`:216`) goes away by making `SegmentConfig` match `LevelSegment`'s optionality. The schema requires only `index` and `difficulty`; `type`, `meanderStrength`, `verticalBias` and `forwardMomentum` become optional. Readers default at the read site, the way they do today. **Do not write defaults into the document.**
- `LevelLoader.tsx`'s `levelData?: unknown` prop stays `unknown`, because it is input.
- `useLevelEditor.loadFromJSON` is untouched. It accepts drafts that fail the schema, by design.

### 3. The schema covers what the code reads
- **`segments[].gameplay`.** `JSONMapManager.getChunkConfig` reads it into `composeGameplayProfile` (flowCap / surface / ambientTemp / windDry), but `level.schema.json` does not declare it. Add it as an optional object whose fields match `GameplayProfile`'s overridable ones.
- **`ReachSegment.washedOutGap`.** `ReachNormalizer` reads it; add it to `reach.schema.json` as an optional boolean.
- Then run `node scripts/compile-validators.mjs` and keep the drift test green.
- **Never** add `additionalProperties: false` to segments and never enable `removeAdditional`. Both would strip authored keys.
- **Measure the levelValidator chunk before and after.** The #522 A note puts ajv at ~300 B per keyword. Total JS is the budget at risk.

### 4. Delete the dead `JSONLevelLoader` path
- `JSONLevelLoader` (`MapSystem.ts:187-250`, with `hasLevelSections` and `validateAndNormalize`) and `JSONMapManager.loadFromUrl` (`:301`) have no caller in `src/`. knip misses them because they are class members.
- `validateAndNormalize` also drops `hydroEvents` and `hazards` and stores `Vector3`s in a `number[][]` field.
- Delete the whole path. Do not retype it.

### 5. `JSONMapManager.loadLevel` waypoints: test first, then decide
- `MapSystem.ts:288` casts `number[][]` to `THREE.Vector3[]` and feeds `CatmullRomCurve3`. `getPoint` then reads `.x/.y/.z` off tuples, which gives NaN.
- `generateChunk` (`:341`) reads that curve.
- **Step a.** Add a test that `loadLevel` on the meander map yields finite chunk points. If it fails, that proves the path makes NaN today.
- **Step b.** Find whether that path is live in a run: is `generateChunk` reached from `ProceduralMapManager` or the treadmill?
  - **Not live:** map the tuples to `Vector3` (as `useLevel` and `ReachNormalizer` already do). The smokes must stay identical.
  - **Live:** it is a behaviour fix. Stop, record the smoke diff in the PR, and leave the commit for Noah's call.

### 6. Four table tests
- `src/terrain/spawnTiming.test.ts`
  - `spawnProfileEnabled` captures `queryFlags().spawnProfile` at module load, so assert the disabled path.
  - Or set the flag and `vi.resetModules()` before importing.
  - Never assert wall-clock durations.
- `src/systems/map/chunkForecastApply.test.ts` (`baseChunkToSegmentData`, `applyLiveForecast`, `createSegmentData`).
- `src/systems/reach/ReachNormalizer.test.ts`
  - Include a case that pins today's array-position = `index` assumption.
  - `validateReachSegmentSequence` sorts by `index` and checks contiguity; assert that the two agree on a dense manifest.
  - Record a sparse or negative-index reach as a finding, not a fix.
- `src/systems/map/MapSystem.generation.test.ts` (`generateSegmentPath`, `calculateSegmentSpawns`, `ensureTangentContinuity`, `buildProceduralSegment`)
  - Seeded; outputs are finite and tangent-continuous at the joins.
- Negative-path coverage (gpt-oss): check that `levelValidator.test.ts` / `reachValidator.test.ts` already feed malformed JSON and assert `valid: false` with a non-empty `errors[]`. Add the case only if it is missing.

## Boundaries
- **May touch:**
  - `src/maps/assertLevelData.ts`, `src/hooks/useLevel.ts`, `src/experience/LevelLoader.tsx` (types only);
  - `src/systems/map/MapSystem.ts` (steps 4–5 only), `src/formats/*.schema.json`, `src/formats/*.validate.ts` (regenerated, never hand-edited);
  - `src/systems/reach/ReachNormalizer.ts` (types only), `src/utils/{level,reach}Validator.ts`;
  - the test files above, `build-budget.json` (notes only, with a reason).
- **Do not touch:**
  - `src/components/postProcessing/**`, `src/materials/**`, `src/rendering/**`, `src/physics/**`;
  - `src/systems/water/**` (that includes `splashSpawnMath.ts`), `src/sim/**`, `emscripten/**`;
  - `src/maps/registry.ts` imports, `eslint.config.js`, the workflow ratchet;
  - `src/systems/persistence/**`, `src/systems/ghost/**`.
- **Boot path:** no static import of `levelValidator` / `assertLevelData` from `registry.ts`, `TrackManager.tsx`, `MapSystem.ts`, `Experience.tsx`, `index.tsx` or any boot module. `check-build-manifest` fails a lazy chunk that is also imported statically.

## Acceptance
- [ ] `assertLevelData` returns `result.data`; `assertLevelData.test.ts` and `userRiver.test.ts` identity checks green.
- [ ] `useLevel` exposes `levelData: LevelData | null` plus a raw slot; a failed load followed by `reloadCurrent()` retries the same document (new test). There is no `as SegmentConfig`.
- [ ] `gameplay` is in `level.schema.json`, `washedOutGap` is in `reach.schema.json`, the drift test is green, every shipped map still validates (`registry.contract.test.ts`), and the levelValidator chunk delta is stated in the PR.
- [ ] `JSONLevelLoader`, `hasLevelSections` and `JSONMapManager.loadFromUrl` are gone; `pnpm typecheck` (knip) is clean.
- [ ] Step 5: either fixed with smokes identical, or a finding with the test and the smoke diff in the PR.
- [ ] Four new table-test files; `pnpm test` and `pnpm test:perf` green.
- [ ] Non-test `any`-family count ≤ 38 (no new ones): `grep -rE ': any\b|as any\b|as unknown as' src --include=*.ts --include=*.tsx | grep -vE '\.test\.|__tests__|/testing/' | wc -l`.
- [ ] `pnpm typecheck` (incl. strict-buffers + knip), `typecheck:test`, `lint` (0 errors, ≤ 18 warnings).
- [ ] `pnpm build && node scripts/check-build-manifest.mjs --budget` within `build-budget.json` as it stands on `main` (entry 747,000 / boot 2,031,000 / total 3,744,000 B). Measure the real headroom first; do not raise without a reason.
- [ ] `test:input-smoke`, `:gamepad` and `test:replay-smoke` splits and SWE checksums are identical to `main`, recorded before commit 1.

## Out of scope
- `nodePostPipeline.ts` casts and `postNodeTypes.ts` (#534 E).
- `.wsghost` / `PersistenceSystem` typing (#535 C).
- A schema-to-type generator or a different validator library.
- three 0.187.
- `FloatingObjectManager.tsx`'s one disabled `as any`: the `type` prop collides with `RigidBodyProps.type`, and retyping it changes which Rapier body is built.

## Findings to record, not fix here
- `ReachNormalizer` indexes `manifest.segments[i]` by array position. A reach with sparse or negative indices (the level schema allows down to −10) would mis-assign segments.
- Remaining non-test casts outside scope: `MapSystem.ts` (whatever steps 4–5 leave of its 2), `usePlacementData.ts` (2), `PersistenceSystem.ts` (2), `RunnerPhysicsHelpers.ts`, `scriptedRun.ts`, `KeyboardMouseSource.ts`, `SceneLighting.tsx`, `ShaderWarmup.tsx`, `FoliageNodeMaterials.ts`, `sim/*` (2). They are candidates for #535 C.

---

The original 2026-11-04 draft (written against `e92ed98`) is kept in this issue's edit history.
