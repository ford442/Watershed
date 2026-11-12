# Board — what is live

One screen: the open board and what is left of the last one. History (every
day's focus, measurements and dispatch since 2026-08) is
[`docs/archive/swarm/weekly_plan.md`](../archive/swarm/weekly_plan.md); the
per-PR swarm journal is [`docs/archive/swarm/swarm-state.md`](../archive/swarm/swarm-state.md).
Neither is a plan — update this file instead, and keep it to one screen.

_Last updated: 2026-11-12._

## Open board (filed 2026-11-08)

| Issue | Priority | Theme | Status |
|---|---|---|---|
| #554 | P1 | Foundation before the next content round | A.1, B.1, B.4, C, D, E, F in one PR; **open: A.2** (VehicleTuner — needs a decision, see the PR), **B.2** (viewport render scale), **B.3** (one shadow type) |
| #553 | P2 | Content + delivery (hazards re-cut, packs per biome, Director, installable shell) | Its prerequisites from #554 (A.1, B.1, C) are in the PR; raft work should wait for A.2 |
| #555 | P1 | Rendering: one material language (TSL default) | **A** in a PR (TSL smoke + parity + warm-up report in CI); B–E open. The parity scenes and warm-up report name what B has to fix first: TSL top-downs draw no canyon (glacial spawn, meander), TSL weather / mist / stars / rock albedo, and node pipeline count (731 vs 53 programs in the first 3 s) |
| #556 | P1 | Testing: the campaign without a browser | **A** on `main` (#565: runner + world step on SimCore, `ctx.game`, cues, guard); A.1's last import (debug taps → `ctx.debug`) in this PR. **In this PR:** B (Node harness `src/sim/headless`, `pnpm test:campaign`). **Open:** the raft step on SimCore, C–E |
| #557 | P2 | Creator tools: River Workshop | Open |
| #558 | P1 | Access: i18n, UI scale, captions, assists | Open |
| #559 | P1 | Code health: native as strict as TS, god modules split | Open |

## Remainder carried from closed boards

Closed as `completed` with phases not on `main`. They are not re-opened; each is
folded into a live issue above.

| From | Remainder | Now owned by |
|---|---|---|
| #522 | B–F (hazards beyond Phase A) | #553 |
| #536 | B–E (packs beyond the core hull) | #553 |
| #533 | D (emsdk 4.x pin bump) | #554 C — in the PR (4.0.23) |
| #519 | C.2 (one shadow type across the AA band), C.3 (viewport render scale), D (half-float SWE textures) | #554 B.3 / B.2 (open) / B.1 (in the PR) |
| #534 | D.2 (wasm fetched once by the main thread, transferred in `INIT`) | #554 B.4 — in the PR |
| #535 | `VehicleTuner` liveness / home | #554 A.2 (open) |

## Ratchets on `main`

| Gate | Value | Where |
|---|---|---|
| Lint warnings | see `--max-warnings` in `.github/workflows/build.yml` | [`ALLOCATION_BASELINE.md`](./ALLOCATION_BASELINE.md) |
| Entry / boot / total JS | ceilings in `build-budget.json` | [`BUILD_HYGIENE.md`](./BUILD_HYGIENE.md) |
| WASM toolchain | `emscripten/EMCC_VERSION` | [`WASM.md`](../../WASM.md) |
| GLSL vs TSL per-host mismatch | `maxMismatch` per scene in `src/debug/hostParity.ts` (lower only) | [`RENDERER.md`](./RENDERER.md#per-host-parity-555-a2) |
