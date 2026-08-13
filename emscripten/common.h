/**
 * common.h — shared value types, constants, and math helpers.
 *
 * Included by forces.h and swe.h (and transitively by forces.cpp / swe.cpp /
 * bindings.cpp). Embind-free by design: <emscripten/bind.h> is quarantined
 * to bindings.cpp only, so this header must never pull it in.
 */

#ifndef WATERSHED_COMMON_H
#define WATERSHED_COMMON_H

#include <cstdint>

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------
static constexpr float WATER_DENSITY_DEFAULT = 1000.0f;  // kg/m³  (fresh water)
static constexpr float GRAVITY_DEFAULT       = 9.80665f; // m/s² (standard gravity)
static constexpr float DAMPING_COEFF         = 0.1f;     // velocity damping per second

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in WatershedWasm.ts. */
static constexpr int WATER_FORCE_INPUT_STRIDE  = 8;
static constexpr int WATER_FORCE_OUTPUT_STRIDE = 8;

// ---------------------------------------------------------------------------
// Value types crossing the Embind boundary
// ---------------------------------------------------------------------------

/** 3-component float vector (returned by computeFlowForce). */
struct Vec3 {
    float x = 0.f, y = 0.f, z = 0.f;
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
inline float clampf(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

#endif  // WATERSHED_COMMON_H
