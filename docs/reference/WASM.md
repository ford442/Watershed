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
├── bindings.cpp  # the only EMSCRIPTEN_BINDINGS block + getVersion()
└── host_smoke.cpp # host assert runner (no Embind)
```

`main.cpp` is gone. Compute library: `forces.cpp`, `swe.cpp`, `chores.cpp`. WASM executable adds `bindings.cpp`. Host executable is `watershed_host_smoke`.

Hard rules:

- `#include <emscripten/bind.h>` appears only in `bindings.cpp`.
- Compute TUs never include `<emscripten/emscripten.h>`. Use `WATERSHED_KEEPALIVE` from `common.h`.
- Bound types (`Vec3`, `WaterForceResult`) are concrete and non-polymorphic;
  `bindings.cpp` `static_assert`s `!std::is_polymorphic_v<T>` for each.
- `forces.cpp` / `swe.cpp` / `chores.cpp` compile with `-fno-rtti -fno-exceptions`. The
  bindings TU keeps RTTI so Embind `typeid` matches the embind library
  (a `-fno-rtti` + `EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0` bindings TU left
  every `function()` unbound at runtime).
- `value_object` registrations run before any `function()` that uses those types.
- Default CMake target has no `-pthread` / `SHARED_MEMORY`. Threads remain
  `WATERSHED_THREADS=ON` / `./build.sh --threads` only.

## Host build + clangd

```bash
cmake -S emscripten -B emscripten/build-host
cmake --build emscripten/build-host
./emscripten/build-host/watershed_host_smoke   # or: pnpm test:native
```

`CMAKE_EXPORT_COMPILE_COMMANDS ON` for both configures. clangd uses the **host**
database (`emscripten/build-host` via `.clangd`). WASM `em++` compile commands
stay in `emscripten/build/` and are not copied over the host DB.

`-msimd128` is used by the SWE damping kernel in `swe.cpp` (`simdf32.h`). The
flux loops are scalar: an HLL solve branches per interface (dry/wet, subsonic /
supersonic), so lane-wise divergence would cost more than it saves. Host goldens
cover CFL clamp, uniform-flow preservation, lake-at-rest well-balancing,
wetting/drying, and a 1D dam break.

## ABI version

`getVersion()` is **6** in source. `MIN_WASM_ABI_VERSION` is **6**.

| Version | Change |
|---------|--------|
| 1 | Initial buoyancy / drag / flow surface |
| 2 | Batched `computeWaterForcesBatch` + SWE grid helpers |
| 3 | First `.cpp` split (`forces` / `swe` / `bindings`) |
| 4 | Header split + Embind quarantine |
| 5 | Optional gpu-chores TU (`chores.cpp`) — HUD reduce/hist/downsample/blur. Not SWE. |
| 6 | **Breaking.** Nonlinear well-balanced SWE with wetting/drying; `stepShallowWater` takes a bed pointer as its 4th argument. |

`src/systems/water/WatershedWasm.ts` asserts `getVersion() >= MIN_WASM_ABI_VERSION`.
Versions 1–5 were additive, so the floor could stay at 4 and an older shipped
binary still loaded for water forces. **ABI 6 is not additive** — it changed
`stepShallowWater`'s arity, so a pre-6 binary cannot be called at all and the
floor moves with it. A stale binary now fails the assertion loudly and the game
falls back to TypeScript forces with visual SWE off, rather than calling into a
shifted argument list.

> **`public/watershed_native.{js,wasm}` are committed build artifacts.** Any
> change under `emscripten/` requires `pnpm build:wasm` and committing the
> regenerated pair. CI rebuilds and runs `emscripten/smoke_test.mjs` +
> `pnpm test:wasm:parity` against the fresh binary, and the ABI floor above is
> what makes a forgotten rebuild fail instead of silently shipping old physics.

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

Boundaries are transmissive (ghost = interior): the grid is a moving,
player-centred window, so waves must leave it rather than reflect off an
invisible wall a few metres from the raft.

### Field conventions (part of the ABI)

| Field | Meaning |
|-------|---------|
| `h` | Free-surface **perturbation** η (m), 0 at rest — *not* an absolute depth |
| `u`, `w` | Velocity components (m/s) |
| `b` | Bed elevation above the channel floor datum (m); `bPtr == 0` means a flat bed |

Total depth is `H + h − b`. `h` stays a perturbation because `FlowingWater`
displaces vertices by it directly — switching it to an absolute depth would
change every water visual and invalidate the visual-smoke baselines.

`createSWEGrid()` allocates the bed alongside `h`/`u`/`w` and zero-fills it, so
an untouched grid is a flat channel. Populating it from the canyon collision
mesh is Phase 2 of [#374](https://github.com/ford442/Watershed/issues/374).
