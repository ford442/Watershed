/**
 * common.h — shared value types, constants, and math helpers.
 *
 * Included by forces.h and swe.h (and transitively by forces.cpp / swe.cpp /
 * bindings.cpp). Host-clean by design: <emscripten/emscripten.h> is
 * quarantined to bindings.cpp (the C ABI), so this header must never pull it in.
 * Types written through the ABI's out-pointers stay standard-layout.
 */

#ifndef WATERSHED_COMMON_H
#define WATERSHED_COMMON_H

#include <cstddef>
#include <cstdint>
#include <span>

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------
static constexpr float WATER_DENSITY_DEFAULT = 1000.0f;  // kg/m³  (fresh water)
static constexpr float GRAVITY_DEFAULT       = 9.80665f; // m/s² (standard gravity)
static constexpr float DAMPING_COEFF         = 0.1f;     // velocity damping per second

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in WatershedWasm.ts. */
static constexpr int WATER_FORCE_INPUT_STRIDE  = 8;
static constexpr int WATER_FORCE_OUTPUT_STRIDE = 8;
/** Largest batch computeWaterForcesBatch accepts (#502); a larger count is a no-op. */
static constexpr int WATER_FORCE_MAX_SAMPLES = 1 << 16;

/**
 * Largest width or height any grid entry point accepts (#467, #502 for the
 * chores). Larger extents are a no-op rather than an int overflow in
 * width * height — the extents arrive from JS untrusted. The biggest SWE
 * budget is 128 x 80; the biggest chore input is a HUD readback.
 */
static constexpr int SWE_MAX_GRID_EXTENT = 4096;

/** Largest element count a flat (count-addressed) entry point accepts: one full-extent grid. */
static constexpr int WS_MAX_ELEMENTS = SWE_MAX_GRID_EXTENT * SWE_MAX_GRID_EXTENT;

// ---------------------------------------------------------------------------
// Value types
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

// ---------------------------------------------------------------------------
// Heap views
// ---------------------------------------------------------------------------

/**
 * `count` T at heap byte offset `ptr` as a bounds-carrying view (#467, #502).
 * The only pointer → view path: every ws_* entry point turns its raw heap
 * offsets into spans here, so indexing is checked in the sanitizer / fuzz host
 * builds (-D_GLIBCXX_ASSERTIONS). A null pointer is an empty span.
 */
template <typename T>
inline std::span<T> heapSpan(uintptr_t ptr, std::size_t count) noexcept {
    if (ptr == 0) return {};
    return {reinterpret_cast<T*>(ptr), count};
}

/** A width x height f32 plane (row-major). */
inline std::span<float> heapPlane(uintptr_t ptr, int width, int height) noexcept {
    return heapSpan<float>(ptr, static_cast<std::size_t>(width) * static_cast<std::size_t>(height));
}

#endif  // WATERSHED_COMMON_H
