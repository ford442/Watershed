# Visual smoke baselines

Committed reference PNGs for `verification/visual_smoke.mjs` (CI job `visual-smoke`).

| File | Beat | Gate |
|------|------|------|
| `00_start_menu.png` | Start menu over WebGL canyon (`?cleanTest=1&renderer=webgl&screenshot=1`) | **Required** |
| `01_spawn_topdown.png` | Glacier/spawn top-down (`no-pointer-lock`, segment −3) | Best-effort (skipped on F-8) |
| `02_waterfall_topdown.png` | Waterfall top-down (segment 14) | Best-effort |
| `03_slot_topdown.png` | Slot canyon top-down (segment 21) | Best-effort |
| `04_delta_open_water.png` | Delta open water (`?map=delta&vehicle=raft`, segment 6) | Best-effort |
| `05_delta_beach.png` | Delta beach landing (`?map=delta&vehicle=raft`, segment 21) | Best-effort |
| `10_touch_layout.png` | Touch controls at 390×844 (`?input=touch`) | Best-effort |
| `11_glacial_hour06.png` / `12_glacial_hour14.png` | Glacial start segment at a 06:00 / 14:00 launch (the sun moves) | Best-effort |
| `13_meander_hour06.png` / `14_meander_hour14.png` | Meander segment 2 at a 06:00 / 14:00 launch | Best-effort |

**Gate** (#518 C): a best-effort shot over threshold is informational. The run fails on the
required shot (structural or over threshold), on any shot that captured with **no baseline here**
(a new shot lands with its PNG), on a native module fetched twice, and on hard page errors on a
required shot.

Top-down baselines were seeded from historical `verification/webgl/*` captures. Refresh them on a host that can complete a healthy post-start SwiftShader boot (or a real GPU).

## Refresh (one command)

```bash
pnpm build
pnpm preview --host 127.0.0.1 --port 4173 &
UPDATE_BASELINES=1 WATERSHED_URL=http://127.0.0.1:4173 pnpm test:visual-smoke:update
```

Or against the dev server:

```bash
WATERSHED_URL=http://127.0.0.1:3000 pnpm test:visual-smoke:update
```

Commit updated PNGs only when the visual change is intentional.

## SwiftShader note

- Do **not** replace these with first-person post-start captures (sky-only / F-1).
- If topdown boots fail with Maximum update depth (F-8), the harness **skips** those shots instead of treating blank/sky frames as regressions.

## Baseline changes (#518 C, 2026-10-27)

- `01_spawn_topdown.png` — the old file was a capture of the **start menu**, not an in-run frame,
  so every healthy boot "failed" it by ~17.6%. Replaced with the glacial spawn top-down; CI's
  capture of the same shot on `main` (run 39768991687) matches it within 0.15%.
- `14_meander_hour14.png` — the 71% diff was not the moving sun (#515). The old file caught the
  runner back at the start (HUD 0.01 km, first-person framing) because the segment-2 teleport
  had not landed. Replaced with the landed top-down, framed like `13_meander_hour06` (0.10 km).
  Its HUD now reads CANYON SUMMER: before #518 B the treadmill biome debounce only committed
  in a frame gap over 400 ms, so segment 2 still said GLACIER.
- `04_delta_open_water.png`, `05_delta_beach.png` — new (they were missing, which the harness
  now fails on). Both are fog/bloom-heavy under SwiftShader; treat them as smoke, not art.
- Kept: `13_meander_hour06.png` (a landed capture matches it within ~1%; the HUD label is the
  difference). `03_slot_topdown.png` is also a start-menu capture, but today's segment-21 shot
  lands on the WIPEOUT overlay on CI and locally alike, so there is no good frame to baseline
  yet; it stays informational until the teleport is fixed.
- Known flake: the meander top-down teleport lands in roughly one run of two or three locally;
  a capture that misses it diffs ~44% and shows up under "Best-effort over threshold".
