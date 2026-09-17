# Per-frame allocation — Phase 0 baseline and Phase 1 lint inventory

Captured 2026-09-17 against `a97a15a` with `verification/alloc_profile.mjs`.

**Verdict up front: allocation is not a measurable share of frame time in
application code.** No `useFrame`-body allocation site — from any of the files
the R3F lint rules flag — appears anywhere in the top-25 allocators, in either
measured scene. The per-frame-allocation cleanup is therefore *not* worth
doing on performance grounds. What lands instead is this baseline, the lint
inventory below, the `#415` annotations in `SplashSystem.tsx`, and the CI
warning ratchet. That is the outcome the issue lists as explicitly acceptable.

---

## Harness

`verification/alloc_profile.mjs`, run against a **production** `vite build`
served by `vite preview` (not the dev server — React's dev-mode `jsxDEV` path
swamps everything else and is not what ships).

```bash
pnpm build && pnpm preview --port 3100
ALLOC_SETTLE_MS=45000 ALLOC_SAMPLE_MS=60000 \
  WATERSHED_URL=http://127.0.0.1:3100 node verification/alloc_profile.mjs
```

- **Bytes allocated**: CDP `HeapProfiler` sampling profiler (4096 B interval)
  over a 60 s window, after a 45 s settle so chunk-pool warm-up, decoration
  instancing and shader compilation are not counted as per-frame cost.
- **GC**: `MajorGC` / `MinorGC` complete events from the v8 trace.
- **Frame time / heap / physics step**: in-page rAF probe,
  `Performance.getMetrics`, and `window.__watershedPhysicsPerf`.

### Read the frame-time column with care

The container has no GPU; Chrome runs SwiftShader, so the frame loop turns at
**~0.5 FPS**. Consequences, and why the conclusion survives them:

- Frame-time p50/p95/max are software-rasteriser numbers. They are **not** a
  proxy for the 60 FPS target. They are recorded only so a post-change run
  under the identical harness has something to diff against.
- Per-*second* rates under-represent `useFrame` work by ~100×, because ~100×
  fewer frames run per second. **Bytes per frame is the honest normalisation**
  and is what the table reports.
- The distortion applies equally to every per-frame allocator, app and vendor
  alike, so the *share* column — which is the actual finding — is unaffected.

---

## Phase 0 — baseline

| Metric | Ordinary biome (seg 2) | Waterfall (seg 14) |
|---|---|---|
| Frames sampled / window | 34 / 60 s | 34 / 60 s |
| Frame time p50 / p95 / max (ms, SwiftShader — not hardware) | 1980 / 2271 / 2272 | 1975 / 2319 / 2426 |
| **Bytes allocated per frame** | **363 KB** | **375 KB** |
| Total allocated in window | 12.35 MB | 12.74 MB |
| GC events (Major / Minor) | 8 / 34 | 8 / 39 |
| **GC pause max / mean (ms)** | **42.8 / 1.90** | **55.7 / 1.08** |
| GC total in window | 679 ms (1.1 % of wall clock) | 633 ms (1.1 % of wall clock) |
| JS heap used | 82.5 MB | 78.7 MB |
| JS heap total | 112.7 MB | 138.4 MB |
| Physics step avg / p95 / max (ms) | 0.02 / 0.03 / 0.28 | 0.02 / 0.03 / 0.07 |
| Rigid bodies / colliders / collision triangles | 84 / 21 / 3620 | 84 / 21 / 3620 |
| Page errors | 0 | 0 |

### Where the bytes come from

| Bundle | Ordinary biome | Waterfall |
|---|---|---|
| `vendor-three` (three.js internals) | 10.39 MB — **84.1 %** | 10.76 MB — **84.5 %** |
| `index` (**all** of `src/` + React + drei + fiber + zustand) | 1.16 MB — 9.4 % | 1.20 MB — 9.4 % |
| native | 0.76 MB — 6.2 % | 0.73 MB — 5.7 % |
| `vendor-rapier` | 34 KB — 0.3 % | 45 KB — 0.4 % |
| wasm heap | 6 KB — 0.0 % | 0 |

Five sixths of all allocation is inside three.js's own renderer and is out of
scope for this repo. Everything `src/` does — *plus* React, drei, fiber and
zustand — accounts for 9.4 %, roughly **34 KB per frame**.

### What the app-code 9.4 % actually is

Top `index` chunk allocators, resolved through a source-mapped build:

| Ordinary biome | Waterfall | Source |
|---|---|---|
| 100.3 KiB | 112.4 KiB | `Environment/Mushrooms.tsx:138` |
| 96.3 KiB | 80.3 KiB | `Environment/Mushrooms.tsx:127` |
| 72.3 KiB | 104.4 KiB | `Environment/Mushrooms.tsx:149` |
| 84.3 KiB | 56.2 KiB | `Environment/Pebbles.tsx:97` |
| 68.3 KiB | 84.4 KiB | `Environment/Wildflowers.tsx:205` |
| 67.5 KiB | 60.2 KiB | `Environment/Driftwood.tsx:51` |
| 52.2 KiB | 92.4 KiB | `Environment/Pinecone.tsx:34` |
| 52.2 KiB | — | `NonEmptyInstances.tsx:28` |
| 44.2 KiB | 64.3 KiB | `Environment/Reeds.tsx:174` |
| 44.2 KiB | 64.3 KiB | `Environment/Ferns.tsx:159` |

Every one of these is an `instances.map(d => <Instance … />)` **render** call —
React element creation when a track segment recycles through the treadmill —
not a `useFrame` body. The placement data behind them is already `useMemo`'d.
This is inherent to the R3F `<Instance>` pattern, it is bursty rather than
per-frame, and it is *inflated* here for the same reason the frame rate is
low: the camera covers 60 s of downstream travel in 34 frames, so segment
recycles per frame are ~100× over-represented.

**Not one lint-flagged `useFrame` allocation site appears in either top-25.**

This corroborates the issue's own thesis from the other direction: the files
the R3F rules flag hardest (`PhysicsDebugOverlay.tsx`, `SplashSystem.tsx`,
`useRaftControls.ts`) contribute nothing measurable, while the files that do
show up (`Mushrooms`, `Pebbles`, `Driftwood`, `Pinecone`) carry zero R3F
warnings between them. Lint warning count and allocation cost are unrelated
in this codebase.

---

## Phase 1 — lint inventory

`eslint . -f json`, bucketed. **0 errors, 296 warnings** at `a97a15a`.

### By rule

| Count | Rule |
|---|---|
| 127 | `@typescript-eslint/no-unused-vars` |
| 82 | `@react-three/no-new-in-loop` |
| 45 | `react-hooks/exhaustive-deps` |
| 28 | `@react-three/no-clone-in-loop` |
| 6 | `no-useless-assignment` |
| 4 | `no-unused-vars` |
| 3 | `@typescript-eslint/no-unsafe-function-type` |
| 1 | `no-constant-binary-expression` |

**The R3F share is 110 of 296 — 37 %.** The single largest bucket is unused
vars, which has nothing to do with allocation.

### By directory (warnings)

| Count | Directory |
|---|---|
| 75 | `src/components` |
| 49 | `src/vehicles` (30 of them `RaftVehicle`, 12 `RunnerVehicle`) |
| 27 | `src/components/Environment` |
| 22 | `src/systems/water` |
| 19 | `src/components/TrackSegment` |
| 10 | `src/components/LevelEditor` |
| 9 | `src/hooks` |
| 6 | `src/utils` |
| ≤4 each | `src`, `src/systems/audio`, `verification`, `src/systems/map`, `src/systems/pools`, `src/experience`, `src/materials`, `src/rendering`, `src/systems/lod`, … |

### R3F warnings by file

| Count | File |
|---|---|
| 27 | `src/components/PhysicsDebugOverlay.tsx` — debug-gated, not mounted in normal play |
| 21 | `src/systems/water/SplashSystem.tsx` — 16 of them load-bearing, see below |
| 14 | `src/vehicles/RaftVehicle/hooks/useRaftControls.ts` |
| 7 | `src/components/VehicleTuner.tsx` |
| 6 | `src/components/WaterFlowForces.tsx` |
| 6 | `src/components/WaterReflection.tsx` |
| 5 | `src/components/WeatherSystem.tsx` |
| 4 | `src/components/Environment/FloatingDebris.tsx` |
| 4 | `src/components/TrackSegment/PondFog.tsx` |
| 3 | `src/components/EnhancedSky.tsx` |
| 3 | `src/components/PostProcessingPipeline.tsx` |
| ≤2 each | `useWaterFlowField.ts`, `CollisionParticles.tsx`, `FloatingObjectManager.tsx`, `IceSpray.tsx`, `ReactiveAudio.tsx`, `WasmWaterForceTest.tsx`, `SceneLighting.tsx`, `useRiverAudio.ts`, `LODManager.tsx` |

---

## The `SplashSystem.tsx` / #415 conflict

16 of `SplashSystem.tsx`'s 21 R3F warnings are the eight `Float32Array` WASM
heap views re-derived inside the frame callback, in two blocks (splash and
mist). Those are **the fix for #415, not garbage.** The native module ships
`ALLOW_MEMORY_GROWTH=1`; a growth replaces the underlying `ArrayBuffer` and
silently detaches every view made over the old one — `byteLength` goes to 0,
reads return nothing, writes go nowhere. Re-deriving them per frame is what
keeps them bound to the live heap.

`no-new-in-loop` is a bare `CallExpression[callee.name=useFrame] NewExpression`
selector and cannot tell a wasteful `new THREE.Vector3()` from a mandatory heap
rebind. Both blocks now carry an `eslint-disable`/`eslint-enable` pair naming
#415. **Do not hoist them.**

---

## The ratchet

`.github/workflows/build.yml` runs `pnpm lint --max-warnings 280` (296 minus
the 16 warnings the #415 annotations suppress). Errors still fail the build,
and so does any *new* warning; the existing backlog stays non-blocking.

Lower the number whenever the count drops, never raise it. It covers every
rule in the backlog rather than just the two R3F ones, and needs no
commit-hook infrastructure and no per-directory severity overrides in
`eslint.config.js`.
