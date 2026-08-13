# Watershed WASM module (layout + ABI)

Canonical API reference: [../../WASM.md](../../WASM.md).

This page records the Phase C translation-unit split (#354) and the ABI bump.

## Layout

```
emscripten/
├── common.h      # Vec2/Vec3, clamp, density/gravity constants. No Embind.
├── forces.h      # WaterForceResult + buoyancy/drag/flow/batch decls
├── forces.cpp    # implementations (file-local helpers stay in an anonymous namespace)
├── swe.h         # stepShallowWater + allocateGrid / freeGrid
├── swe.cpp       # linearised SWE stepper
└── bindings.cpp  # the only EMSCRIPTEN_BINDINGS block + getVersion()
```

`main.cpp` is gone. Three compile units: `forces.cpp`, `swe.cpp`, `bindings.cpp`.

Hard rules:

- `#include <emscripten/bind.h>` appears only in `bindings.cpp`.
- Bound types (`Vec3`, `WaterForceResult`) are concrete and non-polymorphic;
  `bindings.cpp` `static_assert`s `!std::is_polymorphic_v<T>` for each.
- `forces.cpp` / `swe.cpp` compile with `-fno-rtti -fno-exceptions`. The
  bindings TU keeps RTTI so Embind `typeid` matches the embind library
  (a `-fno-rtti` + `EMSCRIPTEN_HAS_UNBOUND_TYPE_NAMES=0` bindings TU left
  every `function()` unbound at runtime).
- `value_object` registrations run before any `function()` that uses those types.
- Default CMake target has no `-pthread` / `SHARED_MEMORY`. Threads remain
  `WATERSHED_THREADS=ON` / `./build.sh --threads` only.

## ABI version

`getVersion()` is **4**.

| Version | Change |
|---------|--------|
| 1 | Initial buoyancy / drag / flow surface |
| 2 | Batched `computeWaterForcesBatch` + SWE grid helpers |
| 3 | First `.cpp` split (`forces` / `swe` / `bindings`) |
| 4 | Header split + Embind quarantine |

`src/systems/WatershedWasm.ts` asserts `getVersion() >= MIN_WASM_ABI_VERSION`
(currently 4).
