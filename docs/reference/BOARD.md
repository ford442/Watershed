# Board

What is open right now, and the remainder of closed epics that never landed. One screen; the
dated history of every board since 2026-08 is the swarm log,
[`docs/archive/swarm/weekly_plan.md`](../archive/swarm/weekly_plan.md) (archived by #554 F — it is a
log, not a plan, and lives out of the repo root).

Last updated: 2026-11-12. Update this table when an epic opens, closes, or lands a phase.

## Live board

| Issue | Priority | What | State |
|---|---|---|---|
| #554 | P1 | Foundation before the next content round | A.1 + E + F + B.1 landed on `claude/laughing-bohr-0qyiqm`; A.2, B.2–B.4, C, D open (see below) |
| #555 | P1 | Rendering: one material language (TSL default, GLSL dual hosts deleted) | open |
| #556 | P1 | Testing: the campaign without a browser (Node harness on SimCore) | open |
| #558 | P1 | Access: i18n, UI scale, captions, assists, axe in CI | open |
| #559 | P1 | Code health: native as strict as TS, god modules split, one trace | open |
| #557 | P2 | Creator tools: River Workshop | open |

## #554 remainder

| Phase | Item | Why it waits |
|---|---|---|
| A.2 | `VehicleTuner` → `GameplayProfile` rows applied from SimCore `ctx` | Declared gameplay change: needs the raft (delta) replay fixture re-cut with a split table. The dead flow sample is already gone (A.1), so today's tuner is bit-identical to `main`. |
| B.2 | Viewport-based render scale (fixed-size targets, `setViewport` / scissor) | Touches the post chain on both backends; after #555 settles the TSL default. |
| B.3 | One shadow type across the AA band | Preset knob; with B.2. |
| B.4 | `watershed_native.wasm` fetched once on the main thread, transferred in `INIT` | Sim-worker protocol change; its ruler is visual-smoke's fetched-once gate. |
| C | emsdk 4.0.23 + `_LIBCPP_HARDENING_MODE_EXTENSIVE` | Needs the pinned toolchain and the golden checks (`host_smoke`, `nativeDigest`); its own PR. |
| D | Dependency floor (R3F 9.8, React 19.3, zustand 5.1, drei 10.7.9, eslint stack) | Every smoke re-run against the bumps. |

## Older remainders (epics closed with phases unlanded)

| From | Remainder | Where it went |
|---|---|---|
| #522 | B–F (hazards in maps, challenges) | Re-cut as #553 A; #553 closed 2026-11-12 without a PR — not on `main` |
| #536 | B–E (per-biome packs, PWA, river voice) | Re-cut as #553 B, D, E; same — not on `main` |
| #533 | D (emsdk 4.x pin bump) | #554 C |
| #519 | C (render scale as viewport, one shadow type), D (half-float SWE textures) | #554 B.2, B.3, B.1 |
| #534 | D.2 (wasm preload, main-thread fetch) | #554 B.4 |
