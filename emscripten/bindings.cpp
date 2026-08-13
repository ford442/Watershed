/**
 * bindings.cpp — Embind surface for the Watershed WASM module.
 *
 * This is the ABI: anything reachable from TypeScript is listed here, and
 * src/systems/WatershedWasm.ts declares the matching types. Adding, removing, or
 * changing a signature (or a batch stride) means bumping getVersion() below and
 * updating WASM.md.
 *
 * Build:
 *   cd emscripten && ./build.sh
 *   (or) npm run build:wasm
 *
 * Output (placed in public/ so Vite serves them):
 *   public/watershed_native.js   — Emscripten glue + Embind
 *   public/watershed_native.wasm — WASM binary
 */

#include "watershed_native.h"

#include <emscripten/bind.h>

// ---------------------------------------------------------------------------
// Version history
//   1 — initial buoyancy/drag/flow surface
//   2 — batched computeWaterForcesBatch + SWE grid helpers
//   3 — split into forces.cpp / swe.cpp / bindings.cpp (no signature changes)
// ---------------------------------------------------------------------------
int getVersion() noexcept {
    return 3;
}

EMSCRIPTEN_BINDINGS(watershed_native) {
    emscripten::function("getVersion",       &getVersion);
    emscripten::function("calculateBuoyancyAndDrag", &calculateBuoyancyAndDrag);
    emscripten::function("calculateWaterForce", &calculateWaterForce);
    emscripten::function("computeWaterForcesBatch", &computeWaterForcesBatch);
    emscripten::function("computeBuoyancy",  &computeBuoyancy);
    emscripten::function("computeDragForce", &computeDragForce);
    emscripten::function("computeFlowForce", &computeFlowForce);
    emscripten::function("stepShallowWater", &stepShallowWater);
    emscripten::function("allocateGrid",     &allocateGrid);
    emscripten::function("freeGrid",         &freeGrid);

    emscripten::value_object<Vec3>("Vec3")
        .field("x", &Vec3::x)
        .field("y", &Vec3::y)
        .field("z", &Vec3::z);

    emscripten::value_object<WaterForceResult>("WaterForceResult")
        .field("forceX", &WaterForceResult::forceX)
        .field("forceY", &WaterForceResult::forceY)
        .field("forceZ", &WaterForceResult::forceZ)
        .field("buoyancy", &WaterForceResult::buoyancy)
        .field("drag", &WaterForceResult::drag)
        .field("flow", &WaterForceResult::flow)
        .field("turbulence", &WaterForceResult::turbulence)
        .field("submergedRatio", &WaterForceResult::submergedRatio);
}
