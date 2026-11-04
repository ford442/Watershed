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

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>

// ---------------------------------------------------------------------------
// Compile-time constants
// ---------------------------------------------------------------------------
inline constexpr float WATER_DENSITY_DEFAULT = 1000.0f;  // kg/m³  (fresh water)
inline constexpr float GRAVITY_DEFAULT       = 9.80665f; // m/s² (standard gravity)
inline constexpr float DAMPING_COEFF         = 0.1f;     // velocity damping rate (1/s): v *= exp(-DAMPING_COEFF·dt)

/** Batch ABI stride, in floats. Mirrored by WATER_FORCE_*_STRIDE in WatershedWasm.ts. */
inline constexpr int WATER_FORCE_INPUT_STRIDE  = 8;
inline constexpr int WATER_FORCE_OUTPUT_STRIDE = 8;
/** Largest batch computeWaterForcesBatch accepts (#502); a larger count is a no-op. */
inline constexpr int WATER_FORCE_MAX_SAMPLES = 1 << 16;

/**
 * Status of an export that can refuse its arguments (#533). Before ABI 17 a
 * rejected call (an extent past SWE_MAX_GRID_EXTENT, a non-finite scalar, a
 * batch past its cap) was a silent no-op, and the caller read its output
 * buffer as if fresh. Now it returns WS_REJECTED and writes nothing; the TS
 * bindings warn once in dev and keep their own last good result.
 */
inline constexpr int WS_OK = 1;
inline constexpr int WS_REJECTED = 0;

/**
 * Largest width or height any grid entry point accepts (#467, #502 for the
 * chores). Larger extents are a no-op rather than an int overflow in
 * width * height — the extents arrive from JS untrusted. The biggest SWE
 * budget is 128 x 80; the biggest chore input is a HUD readback.
 */
inline constexpr int SWE_MAX_GRID_EXTENT = 4096;

/** Largest element count a flat (count-addressed) entry point accepts: one full-extent grid. */
inline constexpr int WS_MAX_ELEMENTS = SWE_MAX_GRID_EXTENT * SWE_MAX_GRID_EXTENT;

/**
 * `count` elements of `elemSize` bytes, as a byte count in SizeT; 0 when count
 * is outside [1, WS_MAX_ELEMENTS] or the product overflows SizeT.
 *
 * emmalloc's calloc multiplies num * size in wasm32's 32-bit size_t with no
 * overflow check, so allocateGrid(2^30) wrapped to a tiny block that came
 * back as success. The allocators size their block here and pass calloc a
 * byte count. SizeT is a parameter so host_smoke can check the wasm32 width
 * (uint32_t) on an LP64 host, where glibc's own calloc check hides the wrap.
 */
template <typename SizeT>
constexpr SizeT allocBytes(int count, SizeT elemSize) noexcept {
    if (count <= 0 || count > WS_MAX_ELEMENTS) return 0;
    SizeT bytes = 0;
    if (__builtin_mul_overflow(static_cast<SizeT>(count), elemSize, &bytes)) return 0;
    return bytes;
}
static_assert(allocBytes<std::uint32_t>(WS_MAX_ELEMENTS, 4) == 4u * WS_MAX_ELEMENTS,
              "the largest accepted float grid fits a wasm32 size_t");

// ---------------------------------------------------------------------------
// Value types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------
inline float clampf(float v, float lo, float hi) noexcept {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * exp(−x) for the SWE velocity damping, from +, −, ×, an exact floor and an
 * exact power-of-two scale only — no libm call, so the host build and the wasm
 * agree bit for bit on every platform (the native digest is checked on every
 * host, not just glibc ones). Relative error < 1e-7 over the accepted range.
 *
 * Always in (0, 1]: x <= 0 or NaN is 1, x is clamped to 87 (exp(−87) ≈ 1.6e-38,
 * still a normal float). Multiplicative to rounding, so N sub-steps of dt damp
 * like one step of N·dt — the frame-rate-exact property the old linear
 * `1 − dt·k` lacked (it went negative for dt > 1/k).
 *
 * Twin: `expNeg` in src/systems/water/swe.wgsl.
 */
inline float sweExpNeg(float x) noexcept {
    if (!(x > 0.f)) return 1.f;
    x = x < 87.f ? x : 87.f;
    constexpr float kInvLn2 = 1.44269502f;
    // Cody–Waite split of ln 2: kLn2Hi has 16 significant bits, so k · kLn2Hi is exact for k < 2^8.
    constexpr float kLn2Hi = 0.693145751953125f;
    constexpr float kLn2Lo = 1.42860677e-06f;
    const float k = std::floor(x * kInvLn2);
    const float r = (x - k * kLn2Hi) - k * kLn2Lo;  // ≈ [0, ln 2)
    // exp(−r), Horner form of the degree-9 Taylor polynomial (error < 1e-8 on [0, ln 2]).
    float p = 1.f - r * (1.f / 9.f);
    p = 1.f - r * (1.f / 8.f) * p;
    p = 1.f - r * (1.f / 7.f) * p;
    p = 1.f - r * (1.f / 6.f) * p;
    p = 1.f - r * (1.f / 5.f) * p;
    p = 1.f - r * (1.f / 4.f) * p;
    p = 1.f - r * (1.f / 3.f) * p;
    p = 1.f - r * (1.f / 2.f) * p;
    p = 1.f - r * p;
    return std::ldexp(p, -static_cast<int>(k));
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
