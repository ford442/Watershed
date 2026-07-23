# Visual smoke baselines

Committed reference PNGs for `verification/visual_smoke.mjs` (CI job `visual-smoke`).

| File | Beat | Gate |
|------|------|------|
| `00_start_menu.png` | Start menu over WebGL canyon (`?cleanTest=1&renderer=webgl&screenshot=1`) | **Required** |
| `01_spawn_topdown.png` | Glacier/spawn top-down (`no-pointer-lock`, segment −3) | Best-effort (skipped on F-8) |
| `02_waterfall_topdown.png` | Waterfall top-down (segment 14) | Best-effort |
| `03_slot_topdown.png` | Slot canyon top-down (segment 21) | Best-effort |

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
