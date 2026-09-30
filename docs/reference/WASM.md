# Watershed WASM module (layout + ABI)

Canonical API reference: [../../WASM.md](../../WASM.md).

This page records the Phase C translation-unit split (#354) and the ABI bump.

## Layout

```
emscripten/
├── common.h      # Vec2/Vec3, clamp, density/gravity, WATERSHED_KEEPALIVE. No Embind.
├── forces.h      # WaterForceResult + buoyancy/drag/flow/batch decls
├── forces.cpp    # implementations (file-local helpers stay in an anonymous namespace)
├── swe.h         # stepShallowWater + allocateGrid / freeGrid
├── swe.cpp       # nonlinear well-balanced SWE stepper (HLL + hydrostatic reconstruction)
├── simdf32.h     # portable f32x4 (wasm_simd128 / SSE2 / NEON / scalar)
├── chores.h      # optional gpu-chores (reduce/hist/downsample/blur)
├── chores.cpp    # generic grid helpers — not SWE
├── particles.h   # SoA waterfall / splash
├── particles.cpp
├── routing.h     # channel routing along the campaign chain (ABI 10)
├── routing.cpp   # kinematic-storage routing + edge-stage rating
├── bindings.cpp  # the only EMSCRIPTEN_BINDINGS block + getVersion()
└── host_smoke.cpp # host assert runner (no Embind)
```

`main.cpp` is gone. Compute library: `forces.cpp`, `swe.cpp`, `chores.cpp`, `particles.cpp`, `routing.cpp`. WASM executable adds `bindings.cpp`. Host executable is `watershed_host_smoke`.

Hard rules:

- `#include <emscripten/bind.h>` appears only in `bindings.cpp`.
- Compute TUs never include `<emscripten/emscripten.h>`. Use `WATERSHED_KEEPALIVE` from `common.h`.
- Bound types (`Vec3`, `WaterForceResult`) are concrete and non-polymorphic;
  `bindings.cpp` `static_assert`s `!std::is_polymorphic_v<T>` for each.
- `forces.cpp` / `swe.cpp` / `chores.cpp` / `particles.cpp` compile with `-fno-rtti -fno-exceptions`. The
  bindings TU keeps RTTI so Embind `typeid` matches the embind library
  (a `-fno-rtti` + `EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0` bindings TU left
  every `function()` unbound at runtime).
- `value_object` registrations run before any `function()` that uses those types.
- Default CMake target has no `-pthread` / `SHARED_MEMORY`. Threads remain
  `WATERSHED_THREADS=ON` / `./build.sh --threads` only.
- Glue is built for `ENVIRONMENT='web,worker'` on both variants (the Rapier
  worker loads it). Release adds `-fno-finite-math-only` (keeps `isfinite`
  guards alive under `-ffast-math`), `-flto`, `--closure 1`, `FILESYSTEM=0`,
  `MALLOC=emmalloc` (#454). `--threads` output goes to
  `emscripten/build-threads/out/`, never `public/`.
- Linear memory: `INITIAL_MEMORY` 16 MiB, `MAXIMUM_MEMORY` 256 MiB,
  `ALLOW_MEMORY_GROWTH=1`. Growth **replaces** the `ArrayBuffer` and detaches
  every prior `HEAPF32` view (`byteLength === 0`). `heapF32()` in
  `WatershedWasm.ts` rebinds `createSWEGrid` / `createWaterForceBatch` /
  `createPhysicsWorkerWaterBatch` views. Splash/waterfall SoA sites are a
  leftover of closed-unimplemented #415. See [../../WASM.md](../../WASM.md#linear-memory-budget).
- Boot asserts `sha256(glue || wasm)[:16]` against `WASM_ARTIFACT_STAMP` after
  `getVersion()`. Mismatch rejects `getWasm()` so the existing GameHUD
  `wasm-init-banner` fires; TypeScript water-force fallback stays the gameplay path.

## Host build + clangd

```bash
cmake -S emscripten -B emscripten/build-host
cmake --build emscripten/build-host
./emscripten/build-host/watershed_host_smoke   # or: pnpm test:native
```

`CMAKE_EXPORT_COMPILE_COMMANDS ON` for both configures. clangd uses the **host**
database (`emscripten/build-host` via `.clangd`). WASM `em++` compile commands
stay in `emscripten/build/` and are not copied over the host DB.

`-msimd128` is used by `swe.cpp` for **damping**, **conserved-state lift**,
and **CFL max reduction** (`simdf32.h`). The HLL flux / hydrostatic
reconstruction loops are scalar: an HLL solve branches per interface (dry/wet,
subsonic / supersonic), so lane-wise divergence would cost more than it saves
and would risk changing goldens. `particles.cpp` uses 4-wide Euler. Host goldens
cover CFL clamp, uniform-flow preservation, lake-at-rest well-balancing,
wetting/drying, a 1D dam break, the window scroll, and a 128-particle chute AABB.

## ABI version

`getVersion()` is **11** in source. `MIN_WASM_ABI_VERSION` is **8**.

| Version | Change |
|---------|--------|
| 1 | Initial buoyancy / drag / flow surface |
| 2 | Batched `computeWaterForcesBatch` + SWE grid helpers |
| 3 | First `.cpp` split (`forces` / `swe` / `bindings`) |
| 4 | Header split + Embind quarantine |
| 5 | Optional gpu-chores TU (`chores.cpp`) — HUD reduce/hist/downsample/blur. Not SWE. |
| 6 | **Breaking.** Nonlinear well-balanced SWE with wetting/drying; `stepShallowWater` takes a bed pointer as its 4th argument. |
| 7 | Particle SoA (waterfall + splash integrate). Additive; floor stays 6. |
| 8 | `applySWEEvent` hydro source terms. Additive; floor stays 6 (raised to 8 later, once particle SoA + `applySWEEvent` became guaranteed exports). |
| 9 | `scrollShallowWater` — whole-cell scroll of `h`/`u`/`w`/`b` so the moving SWE window stays world-stable. Additive; `stepShallowWater` is unchanged, so the floor stays 8. |
| 10 | Channel routing (`routeReach`, `routeReachSteady`, `routeReachTravelTime`, `routedEdgeState`) and `stepShallowWaterInflow`, the step whose upstream edge takes the routed stage. Additive; `MIN_WASM_ABI_VERSION` stays 8 and the exports are typed optional. |
| 11 | `reserveShallowWaterScratch` — pre-size the solver scratch so no step allocates mid-call; `createSWEGrid` calls it when present. Additive; floor stays 8 (#454). |

`src/systems/water/WatershedWasm.ts` asserts `getVersion() >= MIN_WASM_ABI_VERSION`.
Versions 1–5 were additive, so the floor could stay at 4 and an older shipped
binary still loaded for water forces. **ABI 6 is not additive** — it changed
`stepShallowWater`'s arity, so a pre-6 binary cannot be called at all and the
floor moves with it. A stale binary now fails the assertion loudly and the game
falls back to TypeScript forces with visual SWE off, rather than calling into a
shifted argument list.

> **`public/watershed_native.{js,wasm}` are committed build artifacts.** Rebuild
> both from the same pinned emcc (**3.1.56**) and commit the pair together
> (`src/systems/water/wasmArtifactStamp.ts` is written by `build.sh` for
> cache-busting). CI smokes the **committed** pair with `createWatershedNative()`
> before any rebuild, then `git diff --exit-code`s the artifacts after
> `pnpm build:wasm`. A js+wasm mismatch throws at
> `__embind_register_value_object_field`; GameHUD banners native-init failure
> instead of showing a TypeScript smoke value. Physics still degrades to TS
> force math so the canyon loop stays playable.

## Shallow water solver

`stepShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H)`

Conservative finite-volume update on `(d, d·u, d·w)`, where `d` is the total
water column depth. Interface fluxes use an HLL approximate Riemann solver on top
of an **Audusse hydrostatic reconstruction**, which buys two properties the
pre-6 linearised stepper could not express:

- **Well-balanced** — a flat free surface over an arbitrary bed stays at rest.
  The bed term is folded into the reconstructed interface states rather than
  added as a separate source, so lake-at-rest holds to float round-off
  (goldens assert < 1e-5 m/s over 50 steps) instead of drifting into current.
- **Wetting / drying** — depth is clamped at zero, so a bank standing above the
  free surface is simply a dry cell. This is what will let a slot canyon and a
  delta read as different water in Phase 2, rather than the same rectangle of
  waves with a different palette.

Boundaries are transmissive (ghost = interior), so a wave reaching the edge leaves
rather than reflecting off an invisible wall a few metres from the raft. That only sheds
waves from a **fixed** grid: the grid is a player-centred window that *moves*, and the
solver knows nothing about its origin. Keeping the field world-stable is
`scrollShallowWater`'s job — see [Window scroll](#window-scroll--scrollshallowwater-abi-9).

### Field conventions (part of the ABI)

| Field | Meaning |
|-------|---------|
| `h` | Free-surface **perturbation** η (m), 0 at rest — *not* an absolute depth |
| `u`, `w` | Velocity components (m/s) |
| `b` | Bed elevation above the channel floor datum (m); `bPtr == 0` means a flat bed |

Total depth is `H + h − b`. `h` stays a perturbation because `FlowingWater`
displaces vertices by it directly — switching it to an absolute depth would
change every water visual and invalidate the visual-smoke baselines.

### Window scroll — `scrollShallowWater` (ABI 9)

`scrollShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, shiftX, shiftZ, inflowEta, inflowU, inflowW)`

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
  `stepShallowWater` is unchanged, so `MIN_WASM_ABI_VERSION` stays **8**; the export is typed
  optional in `WatershedWasm.ts`, and `createWasmSweSim` falls back to the TypeScript twin
  (`scrollField`) on an ABI-8 binary.
- **Backends.** The WGSL twin is the `scroll` entry point of `swe.wgsl` (gather into scratch,
  copy back over the field). `WgslSweSim.scroll` shifts its CPU mirror in the same call and drops
  a readback that was taken before the scroll, so readers never pair a stale-frame field with the
  new window origin. One backend per session is unchanged.
- **Pinned by:** `host_smoke.cpp` §7 (kernel semantics, lake-at-rest across scroll + bed rewrite
  on a sloped bed and a U-channel, a scrolled window tracking a fixed one), `smoke_test.mjs`
  (real binary vs a JS reference), `sweScroll.integration.test.ts` (TS against the export;
  `pnpm test:wasm`), and `pnpm test:wgsl` (WGSL vs WASM at 1e-5; the pure scroll is bit-exact).

### Routed upstream edge — `routing.cpp` + `stepShallowWaterInflow` (ABI 10)

The launch hour's `flowRate` enters the chain head (`glacial → … → delta`) as a discharge
(`× ROUTING_NOMINAL_DISCHARGE`, 40 m³/s, which is also the reference: a flowRate-1 hour is rest
at the edge). `routeReach` carries it downstream one segment at a time — four kinematic-storage
reservoirs per segment, real water volume, exact per-step integration, volume conserved to
round-off — and `routedEdgeState` rates the routed discharge at the player's segment into a
stage `eta`. `stepShallowWaterInflow` holds the window's upstream (+Z, last-row) edge at that
stage through a characteristic ghost (incoming invariant from outside, outgoing from inside);
the other three edges stay transmissive, and `eta = 0` over still water is exactly the interior,
so lake-at-rest holds at the reference discharge. `swe.wgsl` carries the same ghost. Additive:
the floor stays 8. Full contract, runtime wiring and tests: [../../WASM.md](../../WASM.md).

`createSWEGrid()` allocates the bed alongside `h`/`u`/`w` and zero-fills it, so
an untouched grid is a flat channel. Live rasterization of the canyon floor is
[`bathymetrySampler.ts`](../../src/systems/water/bathymetrySampler.ts). Gameplay
forces sample `u,w` through [`sampleSWEFlow.ts`](../../src/systems/water/sampleSWEFlow.ts)
into `calculateWaterForce` (authored `flowSpeed` caps `||(u,w)||`; dry cells
do not pull). Canonical TypeScript usage: [../../WASM.md](../../WASM.md).
