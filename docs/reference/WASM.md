# Watershed WASM module (layout + ABI)

Canonical API reference: [../../WASM.md](../../WASM.md).

This page records the Phase C translation-unit split (#354) and the ABI bump.

## Layout

```
emscripten/
├── common.h      # Vec2/Vec3, clamp, density/gravity, WATERSHED_KEEPALIVE. No Embind.
├── forces.h      # WaterForceResult + buoyancy/drag/flow/batch decls
├── forces.cpp    # implementations (file-local helpers stay in an anonymous namespace)
├── swe.h         # stepShallowWater / stepShallowWaterBed + allocateGrid / freeGrid
├── swe.cpp       # nonlinear conservative SWE stepper (wetting/drying, bed)
├── swe_goldens.h # host SWE fixtures (lake at rest / dry basin / dam break)
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

`-msimd128` is used by `forces.cpp` and `chores.cpp` (`simdf32.h`). `swe.cpp` is
scalar by design since ABI 6 — its flux stencil branches per interface. Host
goldens (`swe_goldens.h`) cover well-balancing, wetting/drying, dam break, and
CFL substepping.

## ABI version

`getVersion()` is **6** in source (nonlinear SWE + bed). `MIN_WASM_ABI_VERSION` stays **4**.

| Version | Change |
|---------|--------|
| 1 | Initial buoyancy / drag / flow surface |
| 2 | Batched `computeWaterForcesBatch` + SWE grid helpers |
| 3 | First `.cpp` split (`forces` / `swe` / `bindings`) |
| 4 | Header split + Embind quarantine |
| 5 | Optional gpu-chores TU (`chores.cpp`) — HUD reduce/hist/downsample/blur. Not SWE. |
| 6 | Nonlinear SWE with wetting/drying + optional bed (`stepShallowWaterBed`). `stepShallowWater` keeps its signature; `h` is now total depth. |

`src/systems/water/WatershedWasm.ts` asserts `getVersion() >= MIN_WASM_ABI_VERSION`
(currently 4). The wasm chore lane declines if `reduceF32Grid` is missing so an
older shipped binary still loads for water forces. See [`GPU_CHORES.md`](./GPU_CHORES.md).
`stepSWEGrid()` likewise feature-detects `stepShallowWaterBed`, so an ABI 4/5
binary keeps stepping the visual grid over a flat bed.
