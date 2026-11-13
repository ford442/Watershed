# The one timeline (#559 D / E)

One trace across every thread, in the Chrome Trace Event JSON that
[ui.perfetto.dev](https://ui.perfetto.dev) (and `chrome://tracing`) opens
directly. It replaces "four monitors, three threads, no shared clock": a hitch
can be attributed to a thread from inside the game.

## Recording

| How | What |
|-----|------|
| `?trace=1` | Records from boot. The F3 panel's button reads **Stop & save trace**. |
| F3 → **Record 10 s trace** (or Shift+F3) | On a `?debug=1` / `?trace=1` page: records ten seconds, then downloads `watershed-<build>.trace.json`. |
| `window.__watershed.trace` | `{ start(), stop(), recording() }` on harness pages (`harness/debugApi.ts`); `stop()` resolves to the trace object. |

A player's page never loads any of it: the entry chunk holds only the probes
(`src/debug/trace/traceProbe.ts`, `traceWorkers.ts`); the ring, the session and the
exporter are lazy chunks, and a worker loads its side only on `TRACE_CONNECT`.

## Tracks

| Track | Spans |
|-------|-------|
| `main` | `frame` (R3F's global before / after effects), `input-hub`, `sim-core` → `sim-step` → `sim:<system id>` per SimSystem, `swe-step` (main-thread SWE only), `render` → `post:<pass>` per post pass, `shader-warm-frame` |
| `main: segments` | `segment-build`, `segment-mount` (the `spawnTiming.ts` measures; a mount straddles frames, so its own row) |
| `main: warmup` | `shader-warmup` (the async compile) |
| `main: assets` | `parse-glb` (a pack's GLTF decode; the sim worker's `PARSE_GLB` when #536 B moves it) |
| `main: longtask` | `longtask` entries (Chromium) |
| `sim worker` | One span per command: `STEP`, `BUILD_TILE`, `SCROLL`, `FORCES`, `CHORES`, `PARTICLES_*`, … |
| `rapier worker` | `STEP` and its `world.step` (raft runs with the physics worker) |
| counters | `gpu frame ms` (`gpuTimer.ts`, resolved 2–4 frames late), `js heap MB` (Chromium; a drop is a GC — a page cannot observe GC events, only DevTools can) |

Spans on one track nest; anything that can overlap the frame names its own
track (`traceName(name, track)`).

## Clocks

Each worker has its own `performance.now()`. On `TRACE_CONNECT` the main thread
hands the worker a `MessageChannel` port and runs a SYNC ping-pong (16 rounds,
best round trip): offset = `workerAt − (sentAt + receivedAt) / 2`, error ≤ RTT / 2.
It re-measures at stop and keeps the better handshake (the threads share one
monotonic clock, so the offset is a constant). Each reply also carries the
worker's `performance.timeOrigin`, an independent measure of the same offset;
`metadata.threads[]` records both, and `pnpm test:perf-trace` fails a track more
than 1 ms from it. Worker events are exported on the main thread's clock.

## Cost

Not recording: each probe is a null check. `traceStart()` reads no clock, and
`SimCore.step()` takes its plain loop. Nothing allocates per frame, so
[`ALLOCATION_BASELINE.md`](./ALLOCATION_BASELINE.md) is unchanged. Recording:
each thread has one preallocated ring of 128 Ki events (3 MB), and a span is three
stores. The oldest events are overwritten when the ring is full (`dropped` in
the metadata).

## The CI gate (`pnpm test:perf-trace`, #559 E)

`verification/perf_trace_smoke.mjs` runs the scripted meander with `?trace=1`
(30 sim s, then 32 treadmill appends), three times, and reduces each
`<track>/<span>` in the stepped window to n / p50 / p95. Each metric keeps its
smallest p95 across the runs. It compares that against
`verification/perf-baselines/meander.json`:

- **Calibration-normalised.** Every run also times a fixed JS workload
  (`perfBaseline.mjs`), and the gate compares p95 ÷ calibration, so a slower
  box is not a regression.
- **Gated** (`perf-baselines/tolerance.json`): `main/sim-step`,
  `main: segments/segment-build` (fail above +18 %) and
  `main: segments/segment-mount` (above +30 %). Each also has a raw-ms floor.
  A +20 % p95 on build or the sim step fails (`perfBaseline.test.mjs` pins this).
- **Reported only:** render and post spans, since SwiftShader numbers are not
  GPU numbers.
- **Live phase:** a free-running raft at 480×270 (a scripted run steps the SWE
  on the main thread for determinism, so it has no worker tracks). This gates
  that the main, sim-worker and Rapier-worker tracks are present and aligned
  within 1 ms.

`pnpm perf:compare swe|spawn <report.json>` diffs `profile:swe` /
`profile:spawn` reports the same way (`perf-baselines/swe.json`,
`spawn.json`). CI gates only a large Ultra-grid SWE regression; spawn is
reported only.

**Refreshing a baseline.** `UPDATE_PERF_BASELINE=1 pnpm test:perf-trace`
(or `perf:compare … --update`) rewrites it on this box. CI uploads
`verification/output/perf-trace/meander.candidate.json` on every run, which is
the runner's own numbers in the baseline's shape. Commit that when the runner
image changes, and say so in the PR.
