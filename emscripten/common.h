/**
 * common.h — shared value types, constants, and math helpers.
 *
 * Included by forces.h and swe.h (and transitively by forces.cpp / swe.cpp /
 * bindings.cpp). Embind-free by design: <emscripten/bind.h> is quarantined
 * to bindings.cpp only, so this header must never pull it in.
 * Types that cross the JS↔C++ boundary must stay concrete and non-polymorphic.
 */

#ifndef WATERSHED_COMMON_H
#define WATERSHED_COMMON_H

#include <cstdint>

// Portable keep-alive: used on Emscripten so hello-world C exports survive DCE.
// A no-op on host. Never include <emscripten/emscripten.h> from compute TUs —
// that header is WASM-only and kills the host build.
#if defined(__EMSCRIPTEN__)
#  define WATERSHED_KEEPALIVE __attribute__((used))
#else
#  define WATERSHED_KEEPALIVE
#endif

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
// Value types (Embind-registered in bindings.cpp only)
// ---------------------------------------------------------------------------

/** 2-component float vector (sampling / flow-direction helpers). Not bound. */
struct Vec2 {
    float x = 0.f, z = 0.f;
};

/** 3-component float vector (returned by computeFlowForce). */
struct Vec3 {
    float x = 0.f, y = 0.f, z = 0.f;
};

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
inline float clampf(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

#endif  // WATERSHED_COMMON_H
