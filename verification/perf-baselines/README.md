# Perf baselines

Committed p95 baselines for the perf gates (#559 E). `perfBaseline.mjs` compares
a run against them, calibration-normalised; `tolerance.json` says which keys
gate and by how much. Everything not listed there is reported only.

| File | Suite | Produced by | Recorded on |
|---|---|---|---|
| `meander.json` | scripted meander under `?trace=1` | `pnpm test:perf-trace` | CI `perf-trace` job (ubuntu-latest) |
| `swe.json` | SWE step bench (Node, shipped wasm) | `pnpm profile:swe` | see its `note` |
| `spawn.json` | treadmill appends, Medium / High | `pnpm profile:spawn` | dev box: reported only, nothing gates |

## Record baselines where they are checked

Refresh a baseline from the CI artifact, not from a laptop. The `perf-trace` job
uploads `perf-trace/meander.candidate.json`, which is this runner's numbers in the
baseline's shape. Copy it over `meander.json` and say why in the PR. Recording
locally with `UPDATE_PERF_BASELINE=1` is for before/after comparisons on one box.
Don't commit that result.

## Decision: the `segment-build` failure on `main` (#574 A.2, 2026-11-19)

`main` went red on the commit that introduced the gate (#573, 40fecfc):
`segments/segment-build` p95 14.01 → 32.63 ms. **It was the baseline, not a
regression.**

- **The old baseline came from a dev box.** It was recorded inside #573 itself,
  on a machine whose calibration loop took 8 ms. The CI runner's loop takes
  11.8 ms, and CI's segment-build is tail-heavy: p50 7.8 ms against p95 33.7 ms.
  That tail is core contention (Chrome + SwiftShader + preview on a shared
  runner), which a tight calibration loop doesn't scale with. So normalising by
  calibration could not bridge the two machines.
- **CI agrees with itself.** Min-of-3 p95 on the runner was 32.63 ms at 40fecfc
  and 33.7 ms at 9cdbb55 (+3 %, after the #579 placement split).
- **The code didn't regress.** In an interleaved A/B on one box (single runs,
  under load), 9cdbb55 measured 10.7 / 17.9 / 22.2 / 20.9 / 19.5 ms and 40fecfc
  measured 14.8 / 18.6 / 11.5 / 28.9 ms. The arms overlap entirely. One run's p95
  swings about 2.5× under load, which is why the gate keeps the min of 3 runs.

**What changed:** `meander.json` is now the CI candidate from run 44456711297
(9cdbb55). The tolerances are unchanged: 18 % on segment-build, 30 % on mount,
same floors.

**What would change it:** if two consecutive CI runs on an unchanged tree differ
by more than the tolerance against this baseline, the runner is too noisy for a
p95 gate. Then move `segment-build` / `segment-mount` to report only (drop them
from `tolerance.json` `gated`) and say so here. Keep `sim-step` gated: its p95
on CI stayed at 1.5 ms.
