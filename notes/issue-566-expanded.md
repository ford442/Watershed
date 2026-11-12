Part of #558 (P1 Access: playable by more people). Phase A goes first because every later phase (B scale/contrast,
C not-colour-alone + captions, D assists) adds strings, and #558 C.3 (captions) has to land before #553 A.4's hazard
telegraph stems.

**Expanded 2026-11-12** from three reviews: Gemini (a repo read at `3df3cf9`), gpt-oss-120b (a stress test plus two
alternatives) and Grok (the ecosystem as of Nov 2026). The reviews' line references were re-checked on `main`
`3df3cf9`. What changed from the first pass is in "Corrections to the first pass" at the end.

## Decision: keep an in-house `t()`; make the other locales typed `.ts` modules
- **In-house, no dependency.** For about 100 strings and three locales, Grok's survey (Paraglide JS 3.2, Lingui 6.12,
  i18next 27, react-intl 12, intlayer 9) found none that makes a ~1 kB `t()` over `Intl` obsolete. The byte
  difference is a few kB at most, and the libraries mainly win on tooling, which this project does not need yet.
  typesafe-i18n is stalled, so do not use it. If the runtime grows past the budget below, **Paraglide JS** is the
  fallback (typed message functions, Vite plugin, per-message tree-shaking). Record that in the PR if it happens.
- **Parity at compile time, without a generator.** gpt-oss's main point is right: untyped lazy JSON would leave
  `es` / `fr` unchecked. Its fix, a JSON → TS code generator, is not needed here. `src/i18n/es.ts` and `fr.ts` are
  TypeScript modules typed `satisfies LocaleCatalog` (the shape of `typeof en`, with string leaves) and loaded with
  `import()`. They are still separate lazy chunks, and a missing key, an extra key or a wrong plural shape is a
  `tsc` error. A unit test adds what types cannot catch: every `{placeholder}` in an `en` message must appear in the
  `es` and `fr` message, and vice versa.
- **Rejected from the reviews:** the code generator (above); ICU MessageFormat runtimes and MF2 syntax.
  `Intl.MessageFormat` is still TC39 Stage 1, and a parser costs entry bytes that ~100 strings do not need.
  `Intl.DurationFormat` needs Chrome 129+, above our Chrome 94 floor (Grok confirmed). gpt-oss's bundle figures were
  estimated without access to the code, so they are not used; the PR measures the real ones.

## Context (verified on `main` `3df3cf9`)
- No i18n layer, and no `Intl.*` use anywhere in `src/` today.
- `index.html:2` is a static `<html lang="en">`.
- `useSettingsStore.ts:39` `SETTINGS_VERSION = 2`. `migrateSettings(persisted, _version)` (`:234`) ignores the
  version and **normalises field by field**: each field is read and clamped explicitly, not spread over the defaults.
  So a new `locale` field needs its own line in the returned object, and the defaults alone will not backfill it.
- `eslint.config.js:190–201`: one `no-restricted-syntax` block for `src/**/*.{ts,tsx}` (`...OWNED_GLOBALS,
  HARNESS_ONLY_GLOBALS`), and a second for `src/harness/**`. In flat config, a later block that sets the same rule
  for the same files **replaces** the earlier array, so the UI-literal selectors must be added inside a block that
  also repeats those entries.
- CI already runs `pnpm lint --max-warnings 0` (`build.yml:57`).
- HUD numbers: `GameHUD.tsx:31–35` selectors use `String(Math.round…)` (speed, top speed), `toFixed(2)` (km) and
  `toLocaleString()` (score, high score). Only the last two follow the locale, and `toLocaleString()` builds a new
  formatter on every call. These selectors run on every store update; the component re-renders only when the
  string changes.
- Per-frame path: in the rAF tick, `GameHUD.tsx:165` sets `` el.textContent = `AIR! ${airSeconds.toFixed(1)}s` ``
  every frame while airborne. That allocates a string and writes the DOM even when the value has not changed.
- Formatting that exists today:
  - `maps/campaign.ts:137` `formatDuration` → `` `~${mins} min` `` (used by `StartMenu.tsx:273`, tested in
    `campaign.test.ts`).
  - `GhostTimeDelta.tsx:20–27` `formatDelta` → `±m:ss.cc` with U+2212 for the minus sign, centisecond rounding.
- Code that compares on English labels:
  - `MapSystem.delta.test.ts:108` (`def.label` `toBe('River Delta')`)
  - `campaign.test.ts:69/78/86` (`nextLabel: 'Lumber Flume'` …)
  - `MovementReadoutPanel.tsx:47/150` and `LevelEditor/PathVisualizer.tsx:233` key on labels, but both are on the
    allowlist.

## Scope: every string to move
**JSX text and attributes** (`aria-label` / `title` / `placeholder` / `alt`):
- `StartMenu.tsx`: title, Play Mode, Single Map / Journey, Descent Route, Choose Map, the badges `Last` / `Locked`,
  Vehicle, ENTER, OPTIONS, the WASD hint, five `aria-label`s, the `{label} is a {raft|runner} river` sentence
  (`:313`, built from JSX fragments → two whole messages, `startMenu.raftRiver` / `startMenu.runnerRiver`, each
  with `{map}`; `t()` has no `select`, and two messages are simpler for translators), and the `DIFFICULTY`
  map (`:75`).
- `ui/SettingsPanel.tsx`: loading text, title, section titles, labels and help text, all `aria-label`s, the mixer
  labels (`:79–81`), the page tabs (`~:392`), and the four `` `Rebind ${…} (currently …)` `` template labels
  (`:115–139`).
- `GameHUD.tsx`: WIPEOUT, RESPAWN, New High Score!, RETRY MAP, MENU, the compatibility notice + Dismiss, Score, Top …
  m/s, WGSL, SPRINT, WET, EXPOSURE, High Score: / Top Speed:.
- `PauseMenu.tsx` (PAUSED, RESUME, RESTART, OPTIONS, QUIT, RESTART RUN?, Progress will be lost., six attributes);
  `GraphicsUnsupported.tsx`; `RunResultsPanel.tsx` (NEW PB, PB, DNF, EXPORT .WSGHOST, title);
  `TodaysRiverCard.tsx` (attributes, the `PATTERN` / `WEATHER` maps, the `· H…:00 ·` line, snowpack °C);
  `TouchControls.tsx:95–111`; `LaunchHourPicker.tsx`; `LaunchWeatherPicker.tsx`; `ForecastHUD.tsx` (the `STATE`
  map, `:161/193/222`); `UserRiverPanel.tsx`; `SafeGraphicsBadge.tsx`; `Loader.tsx`; `CachePlacementPanel.tsx:23`
  (cache / caches → a plural message); `ErrorBoundary.tsx`; `ExperienceUI.tsx`; `LoadoutPicker.tsx`.
- Before starting, grep `EnhancedSky.tsx` and `CanyonDecorations.tsx`. Gemini's grep matched them, probably on
  non-UI strings; move only what a player can read.

**Strings built in `.ts` modules.** Rule: these modules return **data (a key plus params, or a structured value)**,
and the component formats it. No English stays in `systems/`.
- `systems/water/hydroHud.ts`: `KIND_LABELS` (`:17–22`), the clause text (`:26–31`) and the `H…:00 instead: ${…join}`
  template (`:84–85`). One message per clause, and the list goes through a cached `Intl.ListFormat`.
- `systems/ghost/hydroFairness.ts:44` and `:149` (`you lost ${seconds}s at ${event.id}, not at the shelf`) →
  `{ kind, seconds, eventId }`. This reaches `RunResultsPanel.tsx:29–31`.
- `systems/score/ScoreSystem.ts:25` (`COMBO`), `:184` (`CACHE RETRIEVED`), `:228` (`UPRIGHT RUN`): popup events
  carry a `labelKey`. Score values, ghost data and checksums do not change (strings are never in the sim state).
- `systems/survival/loadout.ts:27/37/47` labels (`Trail Light`, `Balanced`, …) → keys, shown by `LoadoutPicker`.
- `systems/settings/settingsDerive.ts:70/325` (`ACTION` / `QUALITY` labels used by SettingsPanel `:109/:504`) → keys.
- `maps/registry.ts:100/117/134/146/163` labels → `labelKey`; `maps/campaign.ts:101/128` `nextLabel` → `nextMapId`
  (the component resolves it); `campaign.ts:137` `formatDuration` moves to `src/i18n/format.ts`.
- `experience/hooks/useExperienceWorld.ts:160` `` `CONTINUE TO ${nextLabel.toUpperCase()}` `` → message
  `journey.continueTo` with `{map}`. Casing comes from CSS `text-transform: uppercase` on that button, which follows
  `<html lang>`, instead of `toUpperCase()`.
- Not in scope: the `materialBackend.ts:46`, `physicsWorkerFlag.ts:48` and `gpuTimer.ts:25` reason labels. Only
  `DebugPanel` (allowlisted) shows them.

## Approach
1. **`src/i18n/en.ts`** is the nested `as const` catalog and the key source.
   - A leaf is a `string` or a plural object `{ other: string } & Partial<Record<Intl.LDMLPluralRule, string>>`. Use
     the CLDR categories each locale has; `es` and `fr` are `one` / `many` / `other`, not just `one` / `other`.
   - `MessageKey` is the union of the dotted paths. `MessageParams<K>` is derived from the `{name}` placeholders in
     the `en` string (template-literal types), so `t('hud.topSpeed')` without `{ speed }` is a type error. Plural
     leaves take a `count` param.
   - Casing in `en` values is what shows today ("PAUSED" stays "PAUSED") so `00_start_menu` stays pixel-identical.
     The one exception is the CSS-uppercased `continueTo` above.
2. **`src/i18n/t.ts`**: `t(key, params?)`.
   - Each `(locale, key)` template is split once into a cached array of parts. A call walks that array and does no
     `Object.entries` or per-call regex.
   - Plural selection uses one cached `Intl.PluralRules` per locale.
   - A missing key falls back to `en` (in dev, one `console.warn` per key) and never returns `undefined`.
3. **`src/i18n/format.ts`**: one cached `Intl.NumberFormat` per locale and options set; invalidate on locale change.
   - `formatNumber`, `formatSpeed` (unit `meter-per-second`), `formatKm` (unit `kilometer`, 2 decimals),
     `formatMinutes` (unit `minute`, `~` prefix from the catalog).
   - Number units have been in Chrome since 77, so no `DurationFormat` is needed.
   - **`formatSplit` is the single owner of split and delta formatting, and adopts the shipped `GhostTimeDelta`
     form** (`±m:ss.cc`, U+2212, centisecond rounding, the 59.99 clamp). The decimal separator comes from the
     locale; the visible `en` output does not change. Results and ghost use it too.
4. **Locale state.**
   - `useSettingsStore` gains `locale: 'system' | 'en' | 'es' | 'fr'` (default `'system'`).
   - `SETTINGS_VERSION = 3`. In `migrateSettings`, add a `locale: isLocale(p.locale) ? p.locale : base.locale`
     line. Field-by-field normalisation means no version branch is needed, and a locale change never touches
     comfort values.
   - The resolved locale is `'system'` → the first supported prefix match in `navigator.languages`, else `en`.
   - A small locale store (`useSyncExternalStore`) holds the resolved locale plus the loaded catalogs. `useT()`
     returns a `t` that is **stable per locale** (memoised), so components re-render once on a change, not on every
     render.
   - The resolved locale sets `document.documentElement.lang`.
5. **Lazy locales.** `loadLocale('es' | 'fr')` uses `import('./es')` / `import('./fr')`. While a catalog loads, `en`
   renders, and the swap is one store update. The Options → General page gets a picker. Verify with
   `scripts/check-build-manifest.mjs` that neither catalog is in the entry chunk.
6. **HUD (zero per-frame allocation).**
   - No `t()` or `Intl` call inside the rAF tick.
   - `GameHUD.tsx:165` writes only when the 0.1 s bucket changes. The `AIR!` prefix and the unit come from the
     catalog and are captured into refs on locale change.
   - The `:31–35` selectors use the cached formatters.
   - Leave `:122` / `:214` (class / text writes with no formatting) alone.
   - `docs/reference/ALLOCATION_BASELINE.md` must stay unchanged; read it first.
7. **ESLint (last commit).** Add a `UI_LITERALS` selector array and **one** block for
   `src/components/**/*.{ts,tsx}` and `src/ui/**/*.{ts,tsx}`:
   ```js
   const UI_LITERALS = [
     { selector: 'JSXText[value=/[A-Za-z]{2,}/]', message: 'UI text goes through t() (src/i18n).' },
     { selector: 'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z]{2,}/]', message: '…' },
     { selector: 'JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > JSXExpressionContainer > TemplateLiteral:has(TemplateElement[value.raw=/[A-Za-z]{2,}/])', message: '…' },
     { selector: 'JSXExpressionContainer > Literal[value=/[A-Za-z]{2,}/]', message: '…' },
   ];
   // rules: { 'no-restricted-syntax': ['error', ...OWNED_GLOBALS, HARNESS_ONLY_GLOBALS, ...UI_LITERALS] }
   ```
   - The block repeats `OWNED_GLOBALS` and `HARNESS_ONLY_GLOBALS`, because it replaces the `src/**` block's array
     for these files.
   - Its `ignores` keep the tests and add the allowlist: `DebugPanel.tsx`, `AudioDiagnosticsOverlay.tsx`,
     `MovementReadoutPanel.tsx`, `SWEBedDebugOverlay.tsx`, `LevelEditor/**`. Those files fall back to the base block,
     which keeps the globals rules.
   - Symbols (`×`, `→`, `°`, digits) do not match `/[A-Za-z]{2,}/`. Units go through `format.ts`, so no symbol
     allowlist is needed.
   - The rule cannot see strings in constant maps or `.ts` modules. The scope list above covers those, and the PR
     shows `grep -rnE "'[A-Z][A-Za-z ]{3,}'" src/components src/ui src/systems/{water,ghost,score,survival,settings}`
     with every remaining hit explained.

## Commit order (each commit green on its own)
1. i18n core: `en.ts` skeleton, `t.ts`, `format.ts` + tests (interpolation, plural categories for `en` / `es` / `fr`,
   missing-key fallback, param typing via `// @ts-expect-error`).
2. Settings v3 + migration test (v2 file → `locale: 'system'`; garbage → `'system'`; comfort values unchanged).
3. Formatters replace `campaign.ts:137` and `GhostTimeDelta.formatDelta` (existing tests unchanged in `en`).
4. HUD per-frame: cached formatters, the `AIR!` bucket. `GameHUD.renderCount.test.tsx` stays green; a new test
   asserts no `textContent` write while the bucket is unchanged.
5. Map labels → keys (`registry`, `campaign`, `StartMenu`, `TodaysRiverCard`, `useExperienceWorld`), and update the
   three label-comparing tests to ids / keys.
6. Components (the list above), with label maps moved to keys.
7. `.ts` modules return data: `hydroHud`, `hydroFairness`, `ScoreSystem` popups, `loadout`, `settingsDerive`.
8. `SettingsPanel` (pages, labels, rebind templates).
9. Locale plumbing: resolution, `<html lang>`, the Options picker.
10. `es.ts` / `fr.ts` lazy, the placeholder-parity test, a StartMenu render in `fr` using role / test-id selectors
    (the existing English-text selectors in `PauseMenu.fairness`, `Loader`, `SettingsPanel`, `UserRiverPanel` tests
    keep working in `en`), and the entry-chunk check.
11. The ESLint block (last, so earlier commits never fail the gate), with a fixture test proving each of the four
    selectors fires (`:has` in esquery included) and that a banned global still errors in a UI file.

## Acceptance
- [ ] No user-visible English literal in `src/components` / `src/ui` outside the allowlist, and the lint rule
      enforces it. The `OWNED_GLOBALS` / `HARNESS_ONLY_GLOBALS` rules still fire in those files (test: a fixture
      with a banned global still errors).
- [ ] No English UI strings in the listed `.ts` modules; each returns a key / params or a structured value.
- [ ] `en`, `es`, `fr` ship. `es` / `fr` are `satisfies LocaleCatalog` (`tsc` catches missing or extra keys and plural
      shape), the placeholder-parity test passes, and neither is in the entry chunk.
- [ ] Locale follows `navigator.languages`, can be overridden in Options, persists (v2 → v3 tested), and sets
      `<html lang>`.
- [ ] `formatSplit` is the only split / delta formatter; the `en` output is identical to today's `GhostTimeDelta`.
- [ ] Zero per-frame allocation in the HUD tick (`ALLOCATION_BASELINE.md` unchanged); `GameHUD.renderCount` green.
- [ ] Entry growth ≤ 4 kB, measured and written into `build-budget.json` with the reason only if a ceiling moves.
- [ ] `pnpm typecheck`, `typecheck:test`, `lint --max-warnings 0`, `test`, `test:perf`, `build` pass. Visual smoke
      `00_start_menu` is unchanged in `en`.
- [ ] `pnpm test:input-smoke`, `pnpm test:input-smoke:gamepad` and `pnpm test:replay-smoke` match `main` (splits and
      SWE checksums).

## Out of scope
UI scale / rem conversion (B), glyphs / colour-vision / captions (C), assists (D), axe in CI (E), RTL, developer
overlays and their reason labels, the level editor (#557 owns its UI), dates (none are shown to players today), and
any change to `src/sim/**` or `src/vehicles/**` (#556 owns those).

## Owner decisions
1. **Still open: who writes `es` / `fr`?** The recommendation is a machine-translated first draft with a
   `// needs-review` comment per catalog, reviewed before anything is announced. The plumbing PR must not wait on
   translation quality.
2. **Resolved (recommended): locale lives in the settings store (v3).** The field-by-field normaliser keeps it from
   touching comfort settings.
3. **Resolved (recommended): map names are keys in `en.ts` now.** The registry is code. Per-map `name` per locale in
   the map JSON waits for #557's editor.
4. **Deferred to #557:** the level editor stays allowlisted until #557 ships it to players.
5. **Resolved (recommended): `formatSplit` owns all split / delta formatting** and adopts the shipped
   `±m:ss.cc` / U+2212 form (the first pass said `±m:ss.t`, which would change the ghost HUD).

## Corrections to the first pass
- "Numbers already go through `toLocaleString()`": only score and high score do. Speed, top speed and km use
  `String()` / `toFixed`.
- "A v3 migration": `migrateSettings` ignores its version and normalises field by field, so the change is one
  explicit `locale` line. A version branch does nothing.
- "Add an ESLint rule": a second `no-restricted-syntax` block for the same files silently drops `OWNED_GLOBALS` /
  `HARNESS_ONLY_GLOBALS`. The new selectors go in one block that repeats them.
- "Lint gate once #560 is on main": it is on `main` (`build.yml:57`).
- "`:gamepad`" means `pnpm test:input-smoke:gamepad`.
- `formatSplit` precision: `±m:ss.cc` (shipped), not `±m:ss.t`.
- The scope was missing `ScoreSystem` popups, `loadout` and `settingsDerive` labels, the `StartMenu` difficulty map,
  the `ForecastHUD` / `TodaysRiverCard` maps, `CONTINUE TO …`, and `hydroFairness.ts:149`.
