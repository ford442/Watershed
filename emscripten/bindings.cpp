/**
 * bindings.cpp — Embind surface for the Watershed WASM module.
 *
 * This is the ABI: anything reachable from TypeScript is listed here, and
 * src/systems/WatershedWasm.ts declares the matching types. Adding, removing, or
 * changing a signature (or a batch stride) means bumping getVersion() below and
 * updating WASM.md.
 *
 * This is the only translation unit that includes <emscripten/bind.h> — every
 * other header (common.h, forces.h, swe.h) stays Embind-free.
 *
 * Build:
 *   cd emscripten && ./build.sh
 *   (or) npm run build:wasm
 *
 * Output (placed in public/ so Vite serves them):
 *   public/watershed_native.js   — Emscripten glue + Embind
 *   public/watershed_native.wasm — WASM binary
 */

#include "forces.h"
#include "swe.h"

#include <emscripten/bind.h>
#include <type_traits>

// ---------------------------------------------------------------------------
// Version history
//   1 — initial buoyancy/drag/flow surface
//   2 — batched computeWaterForcesBatch + SWE grid helpers
//   3 — split into forces.cpp / swe.cpp / bindings.cpp (no signature changes)
//   4 — split shared header into common.h / forces.h / swe.h; reordered
//       Embind value_object registration ahead of the functions that use
//       them; added static_assert non-polymorphic guards (no signature
//       changes)
// ---------------------------------------------------------------------------
int getVersion() noexcept {
    return 4;
}

// ---------------------------------------------------------------------------
// RTTI safety: every type crossing the Embind boundary must be concrete and
// non-polymorphic (Embind needs RTTI to resolve base-class pointers, which
// this module doesn't have — it's built with -fno-rtti).
// ---------------------------------------------------------------------------
static_assert(!std::is_polymorphic_v<Vec3>,
              "Vec3 must be non-polymorphic to cross the Embind boundary");
static_assert(!std::is_polymorphic_v<WaterForceResult>,
              "WaterForceResult must be non-polymorphic to cross the Embind boundary");

EMSCRIPTEN_BINDINGS(watershed_native) {
    // Value types must be registered before any function()/class_ that
    // returns or accepts them.
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
}
