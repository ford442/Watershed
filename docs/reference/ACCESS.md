# Access — scale, contrast, colour, captions, assists (#558)

Phase A (typed i18n, #566) is in `src/i18n/`. This page covers B–E.

## UI scale (B.1)

- The root font size is `calc(100% * var(--ui-scale))` (`src/styles/base.css`), so the browser's own
  text size and zoom still multiply it. The touch layer's handheld envelope multiplies `--hud-scale` too.
- Options → Accessibility → **UI scale**, 75–200 % (`uiScale` in the settings store, v4).
  `?uiScale=1.5` overrides it for a page load (the visual smoke and the a11y audit use it).
- The UI stylesheets are rem for type and spacing. `node scripts/px-to-rem.mjs` is the codemod;
  `--check` runs in `pnpm typecheck` and fails on a px length that should be rem. It keeps px, on
  purpose, for hairlines (≤ 2 px), borders, radii, shadows, filters, transforms, `@media` preludes,
  the touch layer's thumb geometry, and any line marked `px-ok`.
- Menus taller than the window scroll (`overflow-y: auto; justify-content: safe center`) — before
  #558 the start menu was already taller than a 720 px window and its top was unreachable.

## Contrast (B.2)

`src/styles/access.css`: `@media (prefers-contrast: more)` and the **High contrast** colour mode
(`data-contrast="more"` on `<html>`) draw opaque black panels with white borders and full-white text;
`@media (forced-colors: active)` keeps bar fills and the forecast strip visible in system colours and
gives every panel and control a border.

## Not colour alone (C.1, C.2)

| HUD state | Shape + word | Colour (palette key) |
|---|---|---|
| Sprint stamina | ● OK / ▲ LOW / ✖ EMPTY | `neutral` / `warn` / `bad` |
| Exposure (cold) | ● MILD / ▲ CHILLED / ✖ SEVERE | `ok` / `warn` / `bad` |
| Wetness | ○ DRY / ◐ DAMP / ● SOAKED | `wetLow` / `wetMid` / `wetHigh` |
| Ghost split delta | ▼ AHEAD / ▲ BEHIND | `ahead` / `behind` |
| Forecast strip cells | ● normal / ▲ high / ◆ flood / ✖ washed out (+ `aria-label`) | `risk*` |
| Results split rows | ▼ faster / = even / ▲ slower | `warn` / `ok` / `bad` |

One palette module: `src/systems/settings/access.ts` (authored palette, grades, glyphs) and
`palettes.ts` (Deuteranopia, Protanopia, Tritanopia, High contrast — a lazy chunk). SettingsSync
writes the active palette as `--a11y-*` custom properties; `access.css` holds the authored values as
defaults. In-world code reads `getAccessPalette()` (`accessRuntime.ts`); the guide ribbon does today,
and the hazard telegraph decals / rim lights (#553) must, through the `telegraph*` keys. Biome looks
are untouched.

## Captions (C.3)

Off by default (Options → Accessibility → Captions). `CaptionLayer` (a lazy chunk, mounted only while
on) registers `captionSound` (`src/systems/audio/captions.ts`) with the AudioManager and bridges
hazard phases. A `caption` event is `{ id, direction (−1 / 0 / 1), priority, seconds? }`; direction is
the sound's position in the camera listener's frame. Covered: impacts, splashes, crash into water,
raft capsize, hard landing, boost, and every hazard's telegraph ("Dam release in 3 s") and active
phase. **#553 A.4:** a new gameplay stem needs a row in `CAPTION_FOR_SOUND` and a `caption.*` key.

## Assists (D)

Options → Assist. Store-free live values in `accessRuntime.ts` (the sim reads them; a headless run
has none).

| Assist | Where | Bit |
|---|---|---|
| Game speed 70–100 % | `SimCoreTick` feeds SimCore `delta × speed` (the step stays 1/60 s); the raft, its worker step and the water forces, which run on the frame clock, scale the same | 1 |
| Non-lethal survival | `runSession` clamps every survival multiplier to neutral; sprint stamina never falls below the recovery threshold | 2 |
| Centreline guide | `GuideRibbon` (lazy) along `SegmentFrame.samples`, 3 segments | 4 |
| Auto-jump at gaps | runner step, `systems/map/autoJump.ts`, on `SegmentFrame.gapT` (`launchShelf` rock / `openFloor` lip) | 8 |
| Hold / toggle sprint, brake, paddle | `InputHub.tick` → `holdToggle.ts`, once for every device; skipped for a scripted / replay run | — (an input preference, like a rebind) |

**Fairness.** Bits are sticky per run (`beginRunAssists` in `initRunSession`). An assisted run's key
carries the bits after the map id (`meander~a3:12345`, `meander~a3@2026-10-21:12345`), so its bests,
splits and PB ghost never meet an unassisted run's or the Daily River card's. `.wsghost` files carry
`assists`; `judgeGhostFairness` refuses a ghost whose assists differ (`assist_mismatch`). Results and
the HUD show **Assisted**. With assists off nothing changes: the key, the fairness hash and the frames
are those of `main`, and a scripted run steps once per frame whatever the game speed.

## Audit (E)

- `pnpm test:a11y` (`verification/a11y_audit.mjs`, needs `pnpm preview`; a step in the visual-smoke
  CI job): axe-core (`@axe-core/puppeteer`, WCAG 2.1 A/AA + best practice) on the start menu and every
  Options page at 100 % and 200 %, the run HUD, pause + its Options, the wipeout results, and the
  touch layout at 100 / 150 / 200 %. Serious / critical violations fail; so does a control cut off by
  `overflow: hidden` or pushed past the side of the window. In-run screens soft-skip when SwiftShader
  cannot boot a run (F-8), with the reason in `verification/output/a11y/report.json`.
- `src/ui/__tests__/menuTraversal.test.tsx`: every control of the start menu, the pause menu and each
  Options page is reached by ArrowDown alone and by d-pad presses through `stepMenuNav`.
