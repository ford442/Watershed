/**
 * bindings.cpp — the ONLY export surface of the Watershed WASM module.
 *
 * This is the ABI: anything reachable from TypeScript is listed here, as a
 * plain `extern "C"` function named `ws_<name>` (JS sees `Module._ws_<name>`),
 * and src/systems/water/wasmAbi.ts declares the matching table. Adding,
 * removing, or changing a signature (or a batch stride) means bumping
 * ws_getVersion() below, updating the wasmAbi.ts table and WASM.md.
 *
 * Plain C ABI since 12 (#467): no Embind, so no RTTI in this TU, no
 * `new Function` invokers in the glue, and no glue/wasm coupling beyond the
 * import/export names. Only scalars and heap byte offsets cross the boundary.
 * The one struct result (RoutedEdge; WaterForceResult and Vec3 too until ABI
 * 15) is written through an out-pointer into a caller-reserved scratch block.
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
//       is no floor any more (wasmLoader.ts, wasmAbiVersion.drift.test.ts).
// ---------------------------------------------------------------------------
static constexpr int WATERSHED_ABI_VERSION = 17;

// Out-pointer layout. Mirrored by the reader in wasmAbi.ts.
static_assert(std::is_standard_layout_v<RoutedEdge> && sizeof(RoutedEdge) == 2 * sizeof(float),
              "RoutedEdge is written as 2 packed floats");

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

WS_EXPORT int ws_getVersion() noexcept {
    return WATERSHED_ABI_VERSION;
}

// ---- Water forces ---------------------------------------------------------

WS_EXPORT int ws_computeWaterForcesBatch(uintptr_t inputPtr, uintptr_t outputPtr, int sampleCount,
                                         float flowSpeed, float waterLevel,
                                         float raftMass, float raftVolume,
                                         float dragCoefficient, float frontalArea, float sideArea,
                                         float timeSeconds,
                                         float turbulenceStrength, float turbulenceFrequency) noexcept {
    return computeWaterForcesBatch(inputPtr, outputPtr, sampleCount, flowSpeed, waterLevel,
                                   raftMass, raftVolume, dragCoefficient, frontalArea, sideArea,
                                   timeSeconds, turbulenceStrength, turbulenceFrequency);
}

// ---- Shallow water --------------------------------------------------------

WS_EXPORT float ws_stepShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                                    int width, int height,
                                    float dt, float g, float dx, float H) noexcept {
    return stepShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H);
}

WS_EXPORT float ws_stepShallowWaterInflow(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                                          int width, int height,
                                          float dt, float g, float dx, float H, float edgeEta) noexcept {
    return stepShallowWaterInflow(hPtr, uPtr, wPtr, bPtr, width, height, dt, g, dx, H, edgeEta);
}

WS_EXPORT int ws_applySWEEvent(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                               int width, int height, float dx, float originX, float originZ, float H,
                               int kind, float cx, float cz, float radius, float strength, float dt) noexcept {
    return applySWEEvent(hPtr, uPtr, wPtr, bPtr, width, height, dx, originX, originZ, H,
                         kind, cx, cz, radius, strength, dt);
}

WS_EXPORT int ws_scrollShallowWater(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                                    int width, int height, int shiftX, int shiftZ,
                                    float inflowEta, float inflowU, float inflowW) noexcept {
    return scrollShallowWater(hPtr, uPtr, wPtr, bPtr, width, height, shiftX, shiftZ,
                              inflowEta, inflowU, inflowW);
}

WS_EXPORT void ws_reserveShallowWaterScratch(int width, int height) noexcept {
    reserveShallowWaterScratch(width, height);
}

WS_EXPORT uintptr_t ws_allocateGrid(int count) noexcept {
    return allocateGrid(count);
}

WS_EXPORT void ws_freeGrid(uintptr_t ptr) noexcept {
    freeGrid(ptr);
}

// ---- Channel routing ------------------------------------------------------

WS_EXPORT int ws_routeReach(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                            float inflowQ, float dt, uintptr_t storagePtr, uintptr_t outflowPtr) noexcept {
    return routeReach(lengthsPtr, slopesPtr, widthsPtr, nSeg, inflowQ, dt, storagePtr, outflowPtr);
}

WS_EXPORT int ws_routeReachLateral(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                                   float inflowQ, uintptr_t lateralPtr, float dt, uintptr_t storagePtr,
                                   uintptr_t outflowPtr) noexcept {
    return routeReachLateral(lengthsPtr, slopesPtr, widthsPtr, nSeg, inflowQ, lateralPtr, dt, storagePtr, outflowPtr);
}

WS_EXPORT int ws_routeReachSteady(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                                  float Q, uintptr_t storagePtr, uintptr_t outflowPtr) noexcept {
    return routeReachSteady(lengthsPtr, slopesPtr, widthsPtr, nSeg, Q, storagePtr, outflowPtr);
}

WS_EXPORT int ws_routeReachTravelTime(uintptr_t lengthsPtr, uintptr_t slopesPtr, uintptr_t widthsPtr, int nSeg,
                                      float Q, uintptr_t lagPtr) noexcept {
    return routeReachTravelTime(lengthsPtr, slopesPtr, widthsPtr, nSeg, Q, lagPtr);
}

/** Writes RoutedEdge (eta, speed) to `outPtr`. */
WS_EXPORT void ws_routedEdgeState(float Q, float Qref, float H, float g, uintptr_t outPtr) noexcept {
    writeOut(outPtr, routedEdgeState(Q, Qref, H, g));
}

// ---- gpu-chores -----------------------------------------------------------

WS_EXPORT int ws_reduceF32Grid(uintptr_t src, int count, uintptr_t out3) noexcept {
    return reduceF32Grid(src, count, out3);
}

WS_EXPORT int ws_histogramF32(uintptr_t src, int count, float rangeMin, float rangeMax, uintptr_t binsPtr) noexcept {
    return histogramF32(src, count, rangeMin, rangeMax, binsPtr);
}

WS_EXPORT int ws_lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr) noexcept {
    return lumaHistogramU8(rgba, pixelCount, binsPtr);
}

WS_EXPORT int ws_downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH) noexcept {
    return downsampleF32(src, srcW, srcH, dst, dstW, dstH);
}

WS_EXPORT int ws_blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height) noexcept {
    return blurSeparableF32(src, dst, width, height);
}

WS_EXPORT int ws_packSurfaceField(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                                  int width, int height, float H, float dx, uintptr_t outRgba) noexcept {
    return packSurfaceField(hPtr, uPtr, wPtr, bPtr, width, height, H, dx, outRgba);
}

// ---- Particle SoA ---------------------------------------------------------

WS_EXPORT uintptr_t ws_allocateParticleSoA(int capacity) noexcept {
    return allocateParticleSoA(capacity);
}

WS_EXPORT void ws_freeParticleSoA(uintptr_t ptr) noexcept {
    freeParticleSoA(ptr);
}

WS_EXPORT uint32_t ws_initWaterfallParticles(uintptr_t base, int capacity, int active,
                                             float width, float height, float depthZ,
                                             float fanSpreadRad, uint32_t seed) noexcept {
    return initWaterfallParticles(base, capacity, active, width, height, depthZ, fanSpreadRad, seed);
}

WS_EXPORT uint32_t ws_stepWaterfallParticles(uintptr_t base, int capacity, int active,
                                             float dt, float width, float height, float depthZ,
                                             uint32_t seed) noexcept {
    return stepWaterfallParticles(base, capacity, active, dt, width, height, depthZ, seed);
}

WS_EXPORT int ws_stepSplashParticles(uintptr_t base, int capacity, int count,
                                     float dt, float gravityY, float damp) noexcept {
    return stepSplashParticles(base, capacity, count, dt, gravityY, damp);
}

// ---- Debug-only ------------------------------------------------------------

#ifdef WATERSHED_TRAP_TEST
/**
 * Debug builds only (CMake WATERSHED_TRAP_TEST, never the shipped pair, so not
 * in the WASM_ABI table or the version): traps on purpose, so ?wasmTrapTest=1
 * can prove a RuntimeError is mapped to a function name (wasmTrap.ts, #502).
 */
WS_EXPORT void ws_trapTest() noexcept {
    __builtin_trap();
}
#endif
