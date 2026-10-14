# Watershed — C++ / Emscripten WASM Module

This document describes the custom WebAssembly module used by Watershed for
performance-critical water simulation and physics calculations.

---

## Overview

The module lives in `emscripten/` and is compiled to
`public/watershed_native.js` + `public/watershed_native.wasm` using
[Emscripten](https://emscripten.org/).

TypeScript bindings are in `src/systems/water/WatershedWasm.ts`.

### Why C++/WASM?

| Concern | JS/GPU approach | C++/WASM approach |
|---------|----------------|-------------------|
| Shallow water equations | Too slow in JS at 60 FPS | Near-native, ≥60 FPS |
| Buoyancy / drag physics | Float32 ops in useFrame | Tight inner loop in C++ |
| Particle sim (1 000+) | GC pressure, branch misses | SIMD, zero GC |
| Portability | Must polyfill on old hardware | Same binary, any modern browser |

---

## Directory layout

```
emscripten/
├── common.h          # Shared constants, Vec2/Vec3, clampf — host-clean
├── forces.h          # WaterForceResult + water-force declarations — host-clean
├── forces.cpp        # Buoyancy / drag / flow / batched water forces
├── swe.h             # Shallow-water solver + heap grid declarations — host-clean
├── swe.cpp           # Nonlinear HLL stepper; SIMD lift/CFL/damping only
├── simdf32.h         # Portable f32x4 (wasm_simd128 / SSE2 / NEON / scalar)
├── chores.h          # Optional gpu-chores (reduce/hist/downsample/blur) — host-clean
├── chores.cpp        # Generic grid helpers; not SWE
├── particles.h       # SoA waterfall / splash integrate — host-clean
├── particles.cpp     # Euler + chute recycle / age
├── routing.h         # Channel routing along the campaign chain — host-clean
├── routing.cpp       # Kinematic-storage routing + edge-stage rating (ABI 10)
├── bindings.cpp      # The C ABI: extern "C" ws_* exports + ws_getVersion(); the only Emscripten include
├── host_smoke.cpp    # Host assert runner (no Emscripten headers)
├── build.sh          # Thin WASM wrapper (flags live in CMake); enforces the emcc pin
├── EMCC_VERSION      # The pinned emcc (3.1.56) — read by build.sh and scripts/emsdk-pinned.sh
└── CMakeLists.txt    # Compute static lib + WASM exe + host smoke; compile_commands ON

src/systems/water/
├── wasmAbi.ts              # WASM_ABI table, WatershedNativeModule, bindNativeModule()
├── wasmLoader.ts           # fetch once, hash once, instantiate, bind — getWasm() + the worker's loader
├── WatershedWasm.ts        # createSWEGrid / createWaterForceBatch (heap views)
├── waterForceFallback.ts   # pure-TS twin of forces.cpp
└── wasmArtifactStamp.ts    # pair stamp + wasm hash, written by build.sh

public/               # COMMITTED build artefacts — the shipped pair
├── watershed_native.js
└── watershed_native.wasm
```

`main.cpp` is gone (#354 split the module into the TUs above). Hard rules:

- `<emscripten/emscripten.h>` appears only in `bindings.cpp`, the plain C ABI (#467). Compute
  TUs build on the host too.
- Every export is `extern "C" EMSCRIPTEN_KEEPALIVE ws_<name>` (JS: `Module._ws_<name>`). Only
  scalars and heap byte offsets cross; the three struct results (`WaterForceResult`, `Vec3`,
  `RoutedEdge`) are written through a trailing out-pointer, and `bindings.cpp`
  `static_assert`s their packed float layout.
- Every TU, `bindings.cpp` included, compiles with `-fno-rtti -fno-exceptions`. There is no
  `--bind` and no RTTI anywhere in the release link.
- The default CMake target has no `-pthread` / `SHARED_MEMORY`. Threads stay
  `WATERSHED_THREADS=ON` / `./build.sh --threads` only, and never ship.

---

## Building

### Toolchain pin (#467)

The shipped pair must come from the emcc named in `emscripten/EMCC_VERSION` (**3.1.56**,
the same version CI's `setup-emsdk` installs). Install it once, into the repo-local
(git-ignored) `./emsdk`, without touching any system emsdk:

```bash
bash scripts/emsdk-pinned.sh                                   # → ./emsdk
WATERSHED_EMSDK_DIR=/opt/emsdk-3.1.56 bash scripts/emsdk-pinned.sh   # or anywhere else
```

`build.sh` uses an `emcc` already on `PATH` if it is at the pin; otherwise it sources the
first emsdk **at the pin** among `./emsdk`, `~/emsdk`, `/usr/local/emsdk`, `/opt/emsdk`,
`/root/emsdk`. A box whose only emsdk is 6.x therefore cannot silently rebuild the shipped
pair:

| Situation | Result |
|-----------|--------|
| emcc at the pin | Builds `public/watershed_native.{js,wasm}` and rewrites `wasmArtifactStamp.ts` |
| emcc ≠ pin | **Exits 1**; `public/` and the stamp are untouched |
| emcc ≠ pin, `WATERSHED_ALLOW_EMCC_MISMATCH=1` | Builds into `emscripten/build/out/` only — never `public/`, never the stamp |
| No emcc at all | Exits 1 and points at `scripts/emsdk-pinned.sh` |
| `--debug` / `--threads` | Always build aside (`build-debug/out/`, `build-threads/out/`) |

Rebuilding unchanged sources at the pin reproduces the committed pair byte for byte (CI
asserts this with `git diff --exit-code`), so a matching stamp is good evidence the
toolchain is right. Since the plain C ABI (ABI 12) the pin is a **reproducibility** choice,
not a crash guard: any emcc ≥ 3.1.56 (6.x included) builds the same `_ws_*` export list, and
CI's informational *WASM exports on current emsdk* job checks that on every PR.

### pnpm scripts

| Command | Description |
|---------|-------------|
| `pnpm build` | Vite only. Ships the **committed** pair; does not run emcc |
| `pnpm build:full` | `build:wasm` then Vite (the old `pnpm build`) |
| `pnpm build:wasm` | Single-threaded release build → `public/` (pinned emcc required) |
| `pnpm build:wasm:threads` | Multi-threaded build → `emscripten/build-threads/out/` (never shipped) |
| `pnpm build:wasm:debug` | Debug build (assertions, SAFE_HEAP, `-O0 -g3`) → `emscripten/build-debug/out/` |

To debug the debug build in a browser, copy its pair into `public/` locally and do not
commit it — the artifact stamp will not match, so `getWasm()` rejects; that is expected.

### Manual (build.sh)

`build.sh` is a thin wrapper around `CMakeLists.txt` — **all compile/link flags live in CMake**.
Do not duplicate flags in the shell script.

```bash
cd emscripten

# single-threaded (recommended for first-time setup)
./build.sh

# multi-threaded — output goes to emscripten/build-threads/out/, never public/
./build.sh --threads

# debug — output goes to emscripten/build-debug/out/, never public/
./build.sh --debug
```

### Compile contract (#454)

| Flag | Why |
|------|-----|
| `ENVIRONMENT='web,worker'` (both variants) | The sim worker loads the same glue (`src/sim/workerWasm.ts`, #455); the Rapier worker no longer does (Phase B — its raft force comes from the sim worker). `smoke_test.mjs` fails if the glue hard-codes the worker flag. |
| `-ffast-math -fno-finite-math-only` | Keep reassociation for the vectoriser, but stop clang folding `std::isfinite` to `true` — the `chores.cpp` NaN guards depend on it (`gpuChores/watershedHost.integration.test.ts`). |
| `-flto` (compile + link) | Cross-TU inlining across the five compute TUs and `bindings.cpp`. |
| `--closure 1` | Minifies the glue (~5 KB with the C ABI). `_ws_*`, `HEAP*`, `createWatershedNative` are exports and survive. |
| `INCOMING_MODULE_JS_API=wasmBinary,locateFile` | The options `wasmLoader.ts` passes. Named explicitly: emcc 4.x+ dropped `wasmBinary` from the default, and a glue that ignores it fetches the wasm a second time. |
| no `--bind` | The plain C ABI (#467). No Embind invokers, no `new Function`, no RTTI. |
| `-s FILESYSTEM=0`, `-s MALLOC=emmalloc` | No file I/O; a handful of long-lived blocks, so the small allocator wins on size. |

`--threads` builds into `emscripten/build-threads/out/` and never writes `public/` or the
artifact stamp: the single-thread pair is the only thing that ships.

### Host (clangd / smoke, no Emscripten)

Compute TUs (`forces.cpp`, `swe.cpp`, `chores.cpp`, `particles.cpp`, `routing.cpp`) compile with a plain host compiler (C++20). `bindings.cpp` is WASM-only — never `#include <emscripten/emscripten.h>` from compute TUs.

```bash
cmake -S emscripten -B emscripten/build-host
cmake --build emscripten/build-host
./emscripten/build-host/watershed_host_smoke
# or: pnpm test:native
```

Both CMake configures set `CMAKE_EXPORT_COMPILE_COMMANDS ON`:

| Configure | Database | Used by |
|-----------|----------|---------|
| Host (`emscripten/build-host`) | `emscripten/build-host/compile_commands.json` (copied to `emscripten/compile_commands.json`) | clangd via repo-root `.clangd` |
| WASM (`emscripten/build`) | `emscripten/build/compile_commands.json` (`em++`) | not for editing on machines without emsdk |

After clone, `pnpm test:native` configures + builds the host tree (`emscripten/build-host`), which generates clangd's `compile_commands.json` there. Do not commit generated compile databases, and do not symlink them to the repo root — `emscripten/build-host` is the single source of truth for clangd. Host smoke pins buoyancy, one `calculateWaterForce` fixture, and a 32×24 SWE step (CFL clamp + damping + bump golden).

### Linear memory budget

| Flag | Value | Rationale |
|------|-------|-----------|
| `INITIAL_MEMORY` | 16 MiB | The module allocates a few hundred KB at most (largest SWE budget 64×40 × 4 planes, particle SoA, chore scratch). `reserveShallowWaterScratch` (ABI 11, called by `createSWEGrid`) sizes the solver scratch up front, so no step allocates mid-call and the heap does not grow in steady state — `smoke_test.mjs` asserts the heap byte length is unchanged across step / inflow step / scroll at 64×40. |
| `MAXIMUM_MEMORY` | 256 MiB | Hard ceiling so a runaway init or growth loop cannot consume unbounded tab RAM |
| `ALLOW_MEMORY_GROWTH` | 1 | Heap may grow between initial and maximum as SWE grids / particle SoA allocate. Growth **replaces** the `ArrayBuffer`; prior `Float32Array` views detach (`byteLength === 0`). `heapF32()` rebinds the worker water-force batch, SWE grid, and `createWaterForceBatch`. |

Release builds use `-s ASSERTIONS=0` for size; Debug builds enable `ASSERTIONS=2` and `SAFE_HEAP=1`.
### Loading: once, hashed once (#467)

`wasmLoader.ts` is the only place the glue is instantiated — `getWasm()` on the main thread
(`?simWorker=0`, dev tools) and `getWorkerWasm()` in the sim worker both call
`loadWatershedNative()`:

1. `import(glue)` and `fetch(wasm)` in parallel — each file is requested **once** per session.
2. `sha256(wasm bytes)[:16]` must equal `WASM_BINARY_SHA`, and the glue's own
   `WATERSHED_WASM_SHA` export (appended by `build.sh`) must name the same wasm. Either
   mismatch rejects with `WasmProvenanceMismatchError` before anything is instantiated.
3. The same bytes go to the factory as `wasmBinary`, so the bytes hashed are the bytes that run.
4. `ws_getVersion() >= MIN_WASM_ABI_VERSION` (12), then `bindNativeModule()` binds every
   `WASM_ABI` entry; a missing export is a `WasmAbiMismatchError`, not a later crash.

The whole sequence is bounded by an 8 s deadline (`WASM_INIT_TIMEOUT_MS`, `?wasmInitTimeout=`).
Any failure rejects `getWasm()` / resolves the worker's loader to `null`, the GameHUD
`wasm-init-banner` fires, and the TypeScript water-force fallback remains the gameplay path.
`WASM_ARTIFACT_STAMP` (`sha256(glue || wasm)[:16]`) stays the pair's identity for the
cache-busting `?v=` query, `BUILD_ID`, and `scripts/check-build-manifest.mjs`.

The glue is imported by URL, never evaluated from a string or blob, so the module needs only
`script-src 'self' 'wasm-unsafe-eval'`. `public/.htaccess` sends that policy as
**Report-Only** until #485 removes the runtime ajv compiler, which still needs `new Function`.

---

## API reference

Every function below is a `ws_<name>` C export, listed once in `WASM_ABI`
(`src/systems/water/wasmAbi.ts`) with its arity, and bound onto `WatershedNativeModule` by
`bindNativeModule()`: scalar exports are the raw functions themselves; the three struct results
are read back from a scratch block the binding reserves once. `wasmLoader.test.ts` asserts the
glue exposes exactly the table's exports with the declared arities, and
`node scripts/wasm-exports.mjs public <other-dir>` diffs two builds' export lists.

### `getVersion(): number`

Returns the module ABI version integer (currently **12**;
`MIN_WASM_ABI_VERSION` is **12**). Bump in `bindings.cpp` whenever the
exported surface or a batch stride changes. `WatershedWasm.ts` asserts with
`>=`, so an *additive* bump never breaks existing callers — but ABI 6 changed
`stepShallowWater`'s arity, which is why the floor moved with it.

| Version | Change |
|---------|--------|
| 1 | Initial buoyancy / drag / flow surface |
| 2 | Batched `computeWaterForcesBatch` + SWE grid helpers |
| 3 | Split into `forces.cpp` / `swe.cpp` / `bindings.cpp` (no signature changes) |
| 4 | Split shared header into `common.h` / `forces.h` / `swe.h`; Embind quarantined in `bindings.cpp`; reordered Embind `value_object` registration ahead of the functions that use them; added `static_assert` non-polymorphic guards (no signature changes) |
| 5 | Optional gpu-chores (`reduceF32Grid`, `histogramF32`, `lumaHistogramU8`, `downsampleF32`, `blurSeparableF32`). Additive. TS did not require 5; the wasm chore lane declined when exports were missing. |
| 6 | **Breaking.** Nonlinear well-balanced SWE with wetting/drying; `stepShallowWater` gained a bed pointer as its 4th argument. |
| 7 | Particle SoA (`allocateParticleSoA`, `initWaterfallParticles`, `stepWaterfallParticles`, `stepSplashParticles`). Additive; `MIN_WASM_ABI_VERSION` stays 6. |
| 8 | `applySWEEvent` hydro source terms. Additive; `MIN_WASM_ABI_VERSION` stays 6 at the time (raised to 8 later, once particle SoA + `applySWEEvent` became guaranteed exports). |
| 9 | `scrollShallowWater` — whole-cell scroll of `h`/`u`/`w`/`b` so the moving SWE window stays world-stable. Additive; `stepShallowWater` is unchanged, so `MIN_WASM_ABI_VERSION` stays 8 and the export is typed optional. |
| 10 | Channel routing (`routeReach`, `routeReachSteady`, `routeReachTravelTime`, `routedEdgeState`) and `stepShallowWaterInflow`, the step whose upstream edge takes the routed stage. Additive; `MIN_WASM_ABI_VERSION` stays 8 and the exports are typed optional. |
| 11 | `reserveShallowWaterScratch(width, height)` — pre-size the solver scratch (step, upstream-edge ghosts, scroll temp) so a step never allocates mid-call. Additive; `MIN_WASM_ABI_VERSION` stays 8. Same release: glue built for `web,worker`, emmalloc, `FILESYSTEM=0`, 16 MiB heap (#454). |
| 12 | **Breaking (#467).** Plain C ABI: Embind and `--bind` are gone; every export is `extern "C" ws_<name>`. `calculateWaterForce` / `computeFlowForce` / `routedEdgeState` take a trailing out-pointer (8 / 3 / 2 floats). The duplicate `calculateBuoyancyAndDrag` C export is gone. `MIN_WASM_ABI_VERSION` moves to 12 — the binding table cannot drive an Embind binary — and every export is required (the exact stamp check already guaranteed it). |

TypeScript (`wasmLoader.ts`, both owners) asserts `getVersion() >= MIN_WASM_ABI_VERSION` (currently 12).
Versions 1–5 were additive, so the floor could lag behind. ABI 6 is not: a pre-6
binary cannot be called with the new argument list at all, so the floor moves with
it and a stale binary is rejected at load. Chore kernels live in
`emscripten/chores.cpp` and are **not** SWE.

> **`public/watershed_native.{js,wasm}` are committed build artifacts.** Rebuild
> both from the same pinned emcc (**3.1.56**, matching CI) via `pnpm build:wasm`
> (`build.sh` refuses any other emcc)
> and commit the pair together plus `src/systems/water/wasmArtifactStamp.ts`.
> Under Embind (ABI ≤ 11), mixing glue and wasm from different emcc versions threw at
> `__embind_register_value_object_field`. The C ABI removed that coupling — 3.1.56 and 6.x
> build the same export list — but closure still minifies the wasm's import/export names per
> build, so a glue and wasm from different builds still cannot run together. The loader
> rejects such a pair by hash before instantiating it.
>
> CI instantiates the **committed** pair with `node emscripten/smoke_test.mjs`
> (including the no-emcc job) and, after rebuild, `git diff --exit-code`s the
> pair. `getWasm()` rejects on factory/ABI failure; GameHUD banners that error
> and does **not** display the TypeScript smoke number as a health signal.
> `WaterForceSystem` still falls back to TypeScript force math so play continues
> (visual SWE off) — degraded, not broken.

### Adding a translation unit

Add the `.cpp` to `COMPUTE_SOURCES` in `CMakeLists.txt` (the source of truth;
`build.sh` wraps CMake). Declare its functions in a host-clean header
(`common.h`, or a new `<unit>.h` that includes it), export each one as a
`WS_EXPORT ws_<name>` forwarder in `bindings.cpp`, add the matching entry
(arity, and `out` / `returns: 'u32'` where needed) to `WASM_ABI` and the
`WatershedNativeModule` interface in `wasmAbi.ts`, and bump `ws_getVersion()`.
Never put compile or link flags in a shell script.

### `computeBuoyancy(submergedVolume, waterDensity, gravity): number`

Archimedes' principle: **F_b = ρ × V × g**

| Param | Unit | Notes |
|-------|------|-------|
| `submergedVolume` | m³ | Volume below waterline |
| `waterDensity` | kg/m³ | Fresh water = 1000 |
| `gravity` | m/s² | Use 9.80665 |

Returns upward force in **N**.

### `computeDragForce(vx, vy, vz, cd, area, density): number`

Viscous drag: **F_d = ½ · ρ · \|v\|² · C_d · A**

| Param | Unit | Notes |
|-------|------|-------|
| `vx, vy, vz` | m/s | Object velocity |
| `cd` | — | Drag coefficient (raft ≈ 0.47) |
| `area` | m² | Cross-sectional area |
| `density` | kg/m³ | Fluid density |

Returns drag magnitude in **N**.

### `computeFlowForce(vx,vy,vz, fx,fy,fz, flowSpeed, mass, submergedRatio, cd, area): Vec3`

Calculates the river-current force on a partially-submerged object using
relative-velocity drag.  Apply the result as a Rapier impulse:

```typescript
const wasm  = await getWasm();
const force = wasm.computeFlowForce(
  vel.x, vel.y, vel.z,   // object velocity (m/s)
  dir.x, dir.y, dir.z,   // current direction (normalised)
  2.5,                   // flow speed (m/s)
  80,                    // raft mass (kg)
  submergedRatio,        // 0–1
  0.47,                  // C_d
  1.5,                   // area m²
);
rigidBody.applyImpulse({ x: force.x, y: force.y, z: force.z }, true);
```

### `stepShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H): void`

Advances the nonlinear Shallow Water Equations one time step on a Cartesian
grid. All grid arrays must be WASM heap pointers returned by `allocateGrid()`;
`bPtr` may be `0` for a flat bed.

Conservative finite volume (HLL flux + Audusse hydrostatic reconstruction), so
the scheme is **well-balanced** — a flat free surface over an uneven bed stays at
rest instead of generating spurious current — and supports **wetting/drying**,
where a bank above the free surface is simply a dry cell.

Field conventions (part of the ABI):

| Field | Meaning |
|-------|---------|
| `h` | Free-surface **perturbation** η (m), 0 at rest — *not* an absolute depth |
| `u`, `w` | Velocity components (m/s) |
| `b` | Bed elevation above the channel floor datum (m); total depth is `H + h − b` |

`b` is filled from the canyon (#374 Phase 2): `src/systems/water/bathymetrySampler.ts`
rasterizes the live track segments' U-profile onto the player-centred grid and
`WaterForceSystem` uploads it through `grid.b` before each step, so slot canyons run a
narrow wet thalweg between dry banks while a delta stays wet across the same grid. Passing
`0` still means a flat channel, and the host golden in `host_smoke.cpp` covers the sampled
U-channel shape. Writing `grid.b` uses the existing heap view — it is **not** an ABI change.

`h` stays a perturbation because `FlowingWater` displaces vertices by it
directly. Boundaries are transmissive, so a wave reaching the edge leaves rather than
reflecting — but that only sheds waves from a *fixed* grid. The grid is a player-centred
window that moves, and `stepShallowWater` does not shift `h` / `u` / `w`; keeping the field
world-stable is `scrollShallowWater` (ABI 9, below).

The solver internally clamps `dt` to the CFL stability limit
(`dt ≤ 0.4 · dx / max(|v| + √(g d))`), so it is safe to pass `delta` from
`useFrame` directly.

Use the `createSWEGrid()` helper to manage allocations:

```typescript
const wasm = await getWasm();
const grid = createSWEGrid(wasm, 32, 32, 0.5);  // 32×32 cells, 0.5 m each

// Initialise with a Gaussian splash
const cx = grid.width / 2, cz = grid.height / 2;
for (let z = 0; z < grid.height; z++)
  for (let x = 0; x < grid.width; x++) {
    const d = Math.hypot(x - cx, z - cz);
    grid.h[z * grid.width + x] = 1 + 0.4 * Math.exp(-d * d / 10);
  }

// Per-frame in useFrame:
useFrame((_, delta) => {
  wasm.stepShallowWater(
    grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
    grid.width, grid.height,
    delta, 9.8, grid.dx, 1.0   // H=1 m still-water depth
  );
  // Read grid.h for mesh displacement. Feed grid.u / grid.w through
  // sampleSWEFlow into calculateWaterForce (dry cells: speed 0).
});

// On unmount:
grid.dispose();
```

### `scrollShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, shiftX, shiftZ, inflowEta, inflowU, inflowW): void`  (ABI 9)

The live grid is a player-centred **window over the world** (`sweQuality.ts`: 48×32 cells at
0.5 m on High), and its origin follows the vehicle every frame. `stepShallowWater` is
origin-blind and does not move `h` / `u` / `w`, and the bed rasterizer only rewrites `b` — so
without a scroll, η and velocity stay in their old index slots while the canyon moves
underneath them and a splash rides the camera. Transmissive boundaries do **not** fix this:
they let waves leave a *fixed* grid, not a moving one. `scrollShallowWater` is what makes the
window world-stable.

- **Sign.** `shift` is how far the *content* moves through the index frame:
  `dst[x, z] = src[x − shiftX, z − shiftZ]`, i.e. `(oldOrigin − newOrigin) / dx`. A window
  travelling downstream (−Z, gameplay-forward) has a **positive** `shiftZ`: the field slides
  toward higher rows, water leaves off the high-row (upstream) edge, and the low-row
  (downstream) edge is filled. A surviving cell keeps its world position,
  `originZ + row · dx`.
- **Leaving / entering.** Cells that leave are dropped — nothing wraps. Cells that enter take
  the inflow state `(h, u, w) = (inflowEta, inflowU, inflowW)`; pass zeros for rest. Those are
  the ABI's own fields (a perturbation and velocities), not a depth and a flux: total depth needs
  the bed, and an entering cell's bed is only known once the rasterizer has run. The bed plane
  extends its nearest surviving edge, a placeholder for the one frame before the rasterizer
  overwrites it. `bPtr == 0` leaves the bed alone.
- **Whole cells only.** `WaterForceSystem` keeps the window origin on the world's cell lattice
  (`advanceSweWindow`, `sweScroll.ts`) and moves it only once it has drifted a full cell —
  the same gate the bed refresh always used — so sub-cell motion neither scrolls nor
  re-rasterizes. |shift| ≥ the grid extent saturates: a respawn restarts the field at rest.
- **Order, every frame:** `scroll` (previous step's `h/u/w/b` into the new index frame) →
  `refreshBed()` (rewrites `b` with the world-correct floor) → disturbances → `step`.
- **Additive.** Pure data movement — bit-exact, no arithmetic. `getVersion()` is 9, but
  `stepShallowWater` was unchanged, so `MIN_WASM_ABI_VERSION` stayed **8** at the time. Since
  ABI 12 the export is required; the TypeScript twin (`scrollField`) remains the reference for
  the WGSL and sim-worker mirrors.
- **Backends.** The WGSL twin is the `scroll` entry point of `swe.wgsl` (gather into scratch,
  copy back over the field). `WgslSweSim.scroll` shifts its CPU mirror in the same call and drops
  a readback that was taken before the scroll, so readers never pair a stale-frame field with the
  new window origin. One backend per session is unchanged.
- **Pinned by:** `host_smoke.cpp` §7 (kernel semantics, lake-at-rest across scroll + bed rewrite
  on a sloped bed and a U-channel, a scrolled window tracking a fixed one), `smoke_test.mjs`
  (real binary vs a JS reference), `sweScroll.integration.test.ts` (TS against the export;
  `pnpm test:wasm`), and `pnpm test:wgsl` (WGSL vs WASM at 1e-5; the pure scroll is bit-exact).

### Channel routing + the routed upstream edge  (ABI 10)

`flowForecast.ts` turns hour / snowpack / dam release into a `flowRate`. Until ABI 10 that
number only reshaped the authored segment (`applyForecastToSegmentParams`) and reached the
solver as authored `hydroEvents` disks. Now it is a **discharge at the head of the campaign
chain** (`glacial → lumber → meander → hydro → delta`), routed downstream with a travel time,
and the routed discharge at the player's segment drives the SWE window's **upstream edge**.

**`routing.cpp`** (host-clean, same `-fno-rtti -fno-exceptions` as the other compute TUs) —
one number per segment, not a second 2D grid. Each segment is `ROUTING_SUBREACHES` (4)
reservoirs holding their real water volume `S = l·B·y`, `y` from Manning on a wide rectangle
(`n = 0.035`, slope clamped to [0.002, 0.25]). Each step linearises `Q(S)` about the current
state with `Kc = dS/dQ = l / c(Q)`, `c = 5/3 V` the kinematic celerity, and integrates that
reservoir exactly — so a disturbance travels at the kinematic celerity, any `dt` is stable,
and `outflow volume = I·dt − ΔS` conserves volume to round-off (it may diffuse a pulse; it never
gains volume). Arrays are caller-owned `allocateGrid` floats:

| Export | |
|---|---|
| `routeReachSteady(lengths, slopes, widths, nSeg, Q, storage, outflow)` | Steady state carrying `Q` (m³/s) everywhere. |
| `routeReach(lengths, slopes, widths, nSeg, inflowQ, dt, storage, outflow)` | Advance `dt` s with `inflowQ` at the head; `outflow[k]` is segment k's mean outflow over the step. `storage` is `nSeg × 4`. |
| `routeReachTravelTime(lengths, slopes, widths, nSeg, Q, lag)` | Cumulative kinematic travel time (s) from the head to each segment's outflow. |
| `routedEdgeState(Q, Qref, H, g) → { eta, speed }` | Manning rating: `eta = H((Q/Qref)^0.6 − 1)` (clamped to [−0.9H, 2H]), `speed = 2(√(g(H+eta)) − √(gH))`. `Q == Qref` is exactly `(0, 0)`. |

**`stepShallowWaterInflow(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H, edgeEta)`** —
`stepShallowWater` with the upstream edge driven by the routed stage. Downstream is −Z, so the
upstream edge is the face above the **last row** (+Z): the side the player is leaving, the side
`scrollShallowWater` drops cells off when the window travels downstream. Its ghost is a
characteristic inflow: the outgoing invariant `R− = v − 2c` comes from the interior cell, the
incoming one from still water at stage `edgeEta` entering as a simple wave, so the stage flows
in while waves leaving the window still leave. Supercritical inflow takes both invariants from
outside; supercritical outflow is transmissive; a dry column is transmissive. Lateral and
downstream edges stay transmissive, so the window does not reflect. The ghost is written as
the interior plus the jump in the incoming invariant, so `edgeEta = 0` over still water is
**exactly** the interior state, even under the WASM build's `-ffast-math` — lake-at-rest holds at
the reference discharge. The ghost's wave speed joins the CFL max.

- **Runtime.** `riverRouter.ts` owns the heap arrays and the clock: head discharge =
  `computeFlowRate(hour) × ROUTING_NOMINAL_DISCHARGE` (40 m³/s — also the reference `Qref`, so a
  flowRate-1 hour is rest at the edge), spun up over `ROUTING_SPINUP_HOURS` (2 h) before launch,
  then advanced in real seconds with each SWE step. `routingReach.ts` builds the chain's
  `(length, slope, width)` from the treadmill's own generator. `WaterForceSystem` passes
  `edgeEta` into the step and uses the same routed state `(eta, 0, −speed)` as the scroll fill
  and to seed a freshly placed window. A binary without the exports (ABI < 10) steps
  transmissive, as before.
- **Additive.** `stepShallowWater` / `applySWEEvent` / `scrollShallowWater` keep their
  signatures, so `MIN_WASM_ABI_VERSION` stayed **8** at the time (since ABI 12 every export is required).
- **FP contract (#404).** The routing goldens hold across the host (`-ffp-contract=off`) and the
  `-ffast-math` WASM build at 1e-4 relative, so `routing.cpp` needs no pinned FP flags. If they
  ever diverge, pin `-ffp-contract=off` on `routing.cpp` only.
- **WGSL.** `swe.wgsl` carries the same ghost (`upstreamGhost`), switched by the `edgeActive` /
  `edgeEta` params; the routing itself stays in C++ (the WGSL session still loads the WASM module
  for forces and routing).
- **Pinned by:** `host_smoke.cpp` §8 (steady state, a step release reaching the far segment only
  after the lag, volume balance, rating, lake-at-rest at `Qref`, a raised stage entering, the
  routed edge lagging), `smoke_test.mjs` (same goldens against the WASM build),
  `hydroContrast.test.ts` (`pnpm test:wasm`: hydro 06:00 vs 14:00 through the edge alone, every
  chain map, the release lag to the hydro basin, spin-up covering the chain), and
  `pnpm test:wgsl` (edge scenarios + the hydro edge contrast, WGSL vs WASM at 1e-5).

### `allocateGrid(count): number` / `freeGrid(ptr): void`

Low-level heap allocation for custom grids.  Returns a byte-offset pointer
usable as `new Float32Array(module.HEAPF32.buffer, ptr, count)`.

Prefer `createSWEGrid()` which wraps these with automatic live views.

---

## TypeScript usage

```typescript
import { getWasm } from './systems/water/wasmLoader';
import { createSWEGrid } from './systems/water/WatershedWasm';
import { sampleSWEFlow } from './systems/water/sampleSWEFlow';

// In a React component or game-init function:
const wasm = await getWasm();

// Buoyancy calculation
const upForce = wasm.computeBuoyancy(0.9, 1000, 9.8); // 8820 N

// Drag calculation
const drag = wasm.computeDragForce(3, 0, 0, 0.47, 1.5, 1000); // ~3157 N

// SWE grid — always pass bPtr (ABI 6). Dry banks are H + η − b ≤ SWE_DRY_DEPTH.
const grid = createSWEGrid(wasm, 32, 32, 0.5);
wasm.stepShallowWater(
  grid.hPtr, grid.uPtr, grid.wPtr, grid.bPtr,
  grid.width, grid.height, delta, 9.8, grid.dx, 1.0,
);

// Gameplay current: sample u,w (not a second impulse model). Authored
// segment flowSpeed caps ||(u,w)|| · SWE_FLOW_SPEED_SCALE. Dry cells
// return speed 0 (a zero flowDir would otherwise become (0, −1) in C++).
const flow = sampleSWEFlow({
  worldX: pos.x, worldZ: pos.z, flowSpeed: 1.2,
  grid: { ...grid, cellSize: grid.dx, originX, originZ },
  enabled: true,
});
const force = wasm.calculateWaterForce(
  pos.x, pos.y, pos.z, vel.x, vel.y, vel.z,
  flow.dirX, flow.dirZ, flow.speed, /* waterLevel, mass, … */
);

grid.dispose();
```

Pure-TypeScript fallbacks (`buoyancyFallback`, `dragForceFallback`,
`calculateWaterForceFallback`, in `waterForceFallback.ts`) match the C++
implementations — they are what runs when `watershed_native.wasm` fails to load,
so the two must stay in lockstep.

### Parity + integration tests

```bash
pnpm test                 # includes the TS-side fixture pins (no WASM needed)
pnpm test:native          # host C++ smoke (cmake + watershed_host_smoke)
pnpm test:wasm            # WATERSHED_WASM_INTEGRATION=1 — loads the built module
pnpm test:wasm:parity     # native vs TypeScript force math, per fixture
```

`pnpm test:wasm` and `pnpm test:wasm:parity` require `pnpm build:wasm` to have
produced `public/watershed_native.{js,wasm}` first; without the env var the
native blocks are skipped so CI stays green on a machine with no Emscripten.
Fixtures live in `src/physics/__tests__/waterForceFixtures.ts`.

---

## Threading (pthreads)

The `--threads` build enables Emscripten's pthread support.  This requires
the browser to serve the page with:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

The `vite.config.ts` already sets these headers for the **dev server**. Production
does **not** send them, and the threaded pair is never shipped: `./build.sh --threads`
writes to `emscripten/build-threads/out/` (CI builds it and asserts `public/` is
untouched). Nothing in the C++ creates a thread today.

> **Note:** The single-threaded build (`pnpm build:wasm`) works without
> these headers and is the only one that ships.

---

## Running tests

```bash
npm test -- --testPathPattern=WatershedWasm
```

The tests use a mock `WatershedNativeModule` backed by a real `ArrayBuffer`,
so all Float32Array memory semantics are exercised without requiring Emscripten
at test time.

---

## Performance notes

- **Cold load:** The `.wasm` file is ~30–50 KB gzipped.  Loaded once, cached
  by the browser.
- **No GC pressure:** All simulation memory is in WASM heap (`allocateGrid`).
- **CFL safety:** `stepShallowWater` clamps `dt` internally — no instability
  at low frame rates.
- **SIMD:** After ABI 6, `swe.cpp` uses 4-wide kernels (`simdf32.h`) for:
  1. **velocity damping** (`dampVelocities` on `u`/`w`)
  2. **conserved-state lift** (depth clamp, dry-mask momentum, acc-buffer zero)
  3. **CFL max reduction** (same per-cell `|v|+√(gd)`, then horizontal max)
  The nonlinear **HLL / hydrostatic reconstruction / wetting-drying writeback**
  is scalar. `particles.cpp` uses 4-wide Euler. Emscripten `-msimd128` also
  lets chores autovectorize. Host uses SSE2/NEON. Do not treat the compile
  flag as a vectorized Riemann solver.

---

## Roadmap

| Phase | Status | Description |
|-------|--------|-------------|
| 1 — Build system | ✅ Done | `build.sh`, `CMakeLists.txt`, Vite config, npm scripts; `compile_commands` + host smoke (#372) |
| 2 — Core physics | ✅ Done | Buoyancy, drag, flow force; nonlinear SWE ABI 6 (wetting/drying, bed pointer) |
| 3 — Integration | ✅ Done | Default-on Rapier+WASM worker; `WaterForceSystem` + TS fallback |
| 4 — Bed + force coupling | ✅ Done | Canyon → `b` ([#385](https://github.com/ford442/Watershed/issues/385)); SWE `u,w` → `calculateWaterForce` via `sampleSWEFlow` ([#386](https://github.com/ford442/Watershed/issues/386)) |
| 5 — Source terms / events | ✅ Done | `hydroEvents[]` + `applySWEEvent` (ABI 8, additive) ([#389](https://github.com/ford442/Watershed/issues/389)) |
| 6 — SIMD + particles | ✅ Done | HLL stays scalar; SIMD lift/CFL/damping + particle SoA ([#390](https://github.com/ford442/Watershed/issues/390)) |
| 7 — pthreads / compute SWE | 🟡 WGSL done, sim worker Phases A–B | **[#435](https://github.com/ford442/Watershed/issues/435)**: `src/systems/water/swe.wgsl` twins `stepShallowWater` + `applySWEEvent` on native-WebGPU boots, one backend per session (`sweBackend.ts`); `pnpm test:wgsl` pins parity at 1e-5. **[#455](https://github.com/ford442/Watershed/issues/455)**: the SWE step moved off the main thread into one plain `Worker` (`src/sim/`, `wasm-worker` backend, default on WebGL2; `?simWorker=0` kill switch) — no pthreads, no SharedArrayBuffer, no COOP/COEP; field bit-identical to the main-thread stepper. Phase B moved the river router and the water forces (hull + debris, `simForces.ts`; the Rapier worker's raft over a `MessageChannel`) into the same worker — two module instances per session (main + sim worker), bit-identical forces. Phases C–D (particles/chores, SAB fast path) follow. No Electron. No default-on COOP-COEP / pthreads. |
