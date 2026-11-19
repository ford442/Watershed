/**
 * bindings.cpp — the ONLY export surface of the Watershed WASM module.
 *
 * The exports themselves are declared once, in abi.def (#575), and generated
 * into abi_generated.h by scripts/gen-abi.mjs: one `extern "C" ws_<name>`
 * wrapper per export (JS sees `Module._ws_<name>`) that forwards, argument by
 * argument and by name, to the host-clean implementation in its header.
 * `gen-abi --check` (pnpm typecheck and every CMake build) fails when a
 * header's prototype stops matching abi.def — same types, same names, same
 * order — so nothing here can take its parameters in a different order from
 * the TS table. To add or change an export: edit abi.def, run pnpm gen:abi,
 * bump WS_ABI_VERSION there and add a line below and in WASM.md.
 *
 * Plain C ABI since 12 (#467): no Embind, so no RTTI in this TU, no
 * `new Function` invokers in the glue, and no glue/wasm coupling beyond the
 * import/export names. Only scalars and heap byte offsets cross the boundary.
 * The one struct result (RoutedEdge) is written through an out-pointer into a
 * caller-reserved scratch block; abi_generated.h static_asserts its layout.
 *
 * This is the only translation unit that includes <emscripten/emscripten.h> —
 * every other header (common.h, forces.h, swe.h, chores.h, particles.h,
 * routing.h) compiles on the host too.
 *
 * Build:
 *   cd emscripten && ./build.sh      (or: pnpm build:wasm)
 */

#include "forces.h"
#include "swe.h"
#include "chores.h"
#include "particles.h"
#include "routing.h"

// lint:native (#502) runs clang-tidy over this TU with the HOST compile
// database, where there is no Emscripten sysroot. The fallback keeps the
// exports parseable there; it never reaches a build (the host CMake branch
// does not compile this file).
#if __has_include(<emscripten/emscripten.h>)
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE __attribute__((used))
#endif
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <type_traits>

// ---------------------------------------------------------------------------
// Version history
//   1 — initial buoyancy/drag/flow surface
//   2 — batched computeWaterForcesBatch + SWE grid helpers
//   3 — split into forces.cpp / swe.cpp / bindings.cpp (no signature changes)
//   4 — split shared header into common.h / forces.h / swe.h; Embind
//       quarantined here (no signature changes)
//   5 — optional gpu-chores (reduce/hist/downsample/blur). Additive.
//   6 — nonlinear well-balanced SWE with wetting/drying. stepShallowWater
//       takes a bed pointer (4th arg, 0 = flat bed). BREAKING.
//   7 — particle SoA (waterfall + splash integrate). Additive.
//   8 — applySWEEvent source terms (inflow / vortex / braid / roughness).
//   9 — scrollShallowWater: whole-cell scroll of h/u/w/b. Additive.
//  10 — channel routing (routeReach / routeReachSteady / routeReachTravelTime /
//       routedEdgeState) and stepShallowWaterInflow. Additive.
//  11 — reserveShallowWaterScratch (#454). Additive.
//  12 — BREAKING (#467): plain C ABI. Every export is `ws_<name>` with C
//       linkage; Embind is gone. calculateWaterForce / computeFlowForce /
//       routedEdgeState take a trailing out-pointer (8 / 3 / 2 floats) instead
//       of returning a value object. MIN_WASM_ABI_VERSION moves to 12: the TS
//       binding layer cannot drive an Embind binary at all.
//  13 — terrain tiles (#487): buildTerrainTile / buildWallShell. Additive,
//       but MIN_WASM_ABI_VERSION moves to 13 with it: the loader binds every
//       WASM_ABI entry or rejects, so an ABI 12 binary cannot load anyway.
//  14 — weather on the river: routeReachLateral (lateral inflow per segment),
//       applySWEEvent kind 4 (surge front). Additive; MIN moves to 14 for the
//       same bind-every-entry reason as 13.
//  15 — BREAKING: the single-body force exports are gone —
//       calculateBuoyancyAndDrag, calculateWaterForce, computeBuoyancy,
//       computeDragForce, computeFlowForce had no game caller left (the sim
//       worker and the main thread both use computeWaterForcesBatch, whose
//       per-sample math is calculateWaterForce). MIN moves to 15.
//  16 — BREAKING: buildTerrainTile / buildWallShell are gone with
//       terrain.cpp. The sim worker builds the tile with the same TypeScript
//       as the main thread (src/terrain/terrainTile.ts), so there is one
//       canyon-geometry source instead of a C++ / TS / goldens triangle.
//       MIN moves to 16.
//  17 — BREAKING (#533): one set of numbers, round two.
//       stepShallowWater[Inflow] sub-cycle (≤ 4 CFL steps) and return the
//       time integrated as a float (0 = rejected); damping is exp(−k·dt).
//       Every export that can refuse its arguments returns an int status
//       (WS_OK 1 / WS_REJECTED 0) instead of being a silent no-op:
//       computeWaterForcesBatch, applySWEEvent, scrollShallowWater,
//       routeReach / routeReachLateral / routeReachSteady /
//       routeReachTravelTime, the five chores, stepSplashParticles.
//       New: packSurfaceField (the SWE flow texture's bytes, chores.cpp).
//       The loader now requires version == WASM_ABI_VERSION exactly: there
//       is no floor any more (wasmLoader.ts).
//  18 — BREAKING (#575): finite or refused, one ABI source.
//       The export surface is declared once, in abi.def; these wrappers, the
//       constants, the TS interface (branded parameters), the WASM_ABI table
//       and the WASM.md table are generated from it (scripts/gen-abi.mjs),
//       and gen-abi --check holds the implementation headers to it.
//       computeWaterForcesBatch takes a refused-row plane (3rd argument) and
//       returns WS_PARTIAL when a non-finite row was zeroed. applySWEEvent
//       returns WS_BAD_ARG for a radius / strength / dt past SWE_EVENT_MAX_*.
//       initWaterfallParticles / stepWaterfallParticles return a status and
//       write the seed through a trailing out-pointer.
// ---------------------------------------------------------------------------

namespace {

/**
 * Copy `value` to the heap at `outPtr`. memcpy, not a store through a
 * reinterpret_cast<T*>: the out-block is a float array as far as the
 * allocator knows, and a typed store through an unrelated pointer is UB on
 * the host under UBSan (the wasm build cannot tell, the host smoke can).
 */
template <typename T>
inline void writeOut(uintptr_t outPtr, const T& value) noexcept {
    static_assert(std::is_trivially_copyable_v<T>);
    if (outPtr != 0) std::memcpy(reinterpret_cast<void*>(outPtr), &value, sizeof(T));
}

}  // namespace

#define WS_EXPORT extern "C" EMSCRIPTEN_KEEPALIVE

// The generated exports (abi.def → abi_generated.h).
#define WATERSHED_ABI_EXPORTS
#include "abi_generated.h"

// ---- Debug-only ------------------------------------------------------------

#ifdef WATERSHED_TRAP_TEST
/**
 * Debug builds only (CMake WATERSHED_TRAP_TEST, never the shipped pair, so not
 * in abi.def, the WASM_ABI table or the version): traps on purpose, so
 * ?wasmTrapTest=1 can prove a RuntimeError is mapped to a function name
 * (wasmTrap.ts, #502).
 */
WS_EXPORT void ws_trapTest() noexcept { __builtin_trap(); }
#endif
