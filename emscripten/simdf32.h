/**
 * simdf32.h — portable 4-wide float SIMD for SWE / particle inner loops.
 *
 * wasm_simd128 on Emscripten (-msimd128), SSE2 on x86_64 host, NEON on ARM.
 * Scalar 4-wide fallback otherwise. Algorithm identity is the contract:
 * remainders and HLL / wetting-drying interfaces stay scalar in swe.cpp.
 *
 * After ABI 6, swe.cpp vectorizes: damping, conserved-state lift, CFL max
 * reduction, and acc-buffer zero. It does not vectorize hllFlux.
 */

#ifndef WATERSHED_SIMDF32_H
#define WATERSHED_SIMDF32_H

#include <cmath>

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>

using f32x4 = v128_t;

inline f32x4 f32x4_load(const float* p) { return wasm_v128_load(p); }
inline void f32x4_store(float* p, f32x4 v) { wasm_v128_store(p, v); }
inline f32x4 f32x4_splat(float x) { return wasm_f32x4_splat(x); }
inline f32x4 f32x4_add(f32x4 a, f32x4 b) { return wasm_f32x4_add(a, b); }
inline f32x4 f32x4_sub(f32x4 a, f32x4 b) { return wasm_f32x4_sub(a, b); }
inline f32x4 f32x4_mul(f32x4 a, f32x4 b) { return wasm_f32x4_mul(a, b); }
inline f32x4 f32x4_div(f32x4 a, f32x4 b) { return wasm_f32x4_div(a, b); }
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return wasm_f32x4_max(a, b); }
inline f32x4 f32x4_sqrt(f32x4 a) { return wasm_f32x4_sqrt(a); }
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) { return wasm_f32x4_gt(a, b); }
inline f32x4 f32x4_gt_mask(f32x4 a, f32x4 b) { return f32x4_gt(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) { return wasm_v128_and(a, b); }

#elif defined(__SSE2__) || defined(_M_X64) || defined(_M_AMD64) \
    || (defined(_M_IX86_FP) && _M_IX86_FP >= 2)
#include <emmintrin.h>

using f32x4 = __m128;

inline f32x4 f32x4_load(const float* p) { return _mm_loadu_ps(p); }
inline void f32x4_store(float* p, f32x4 v) { _mm_storeu_ps(p, v); }
inline f32x4 f32x4_splat(float x) { return _mm_set1_ps(x); }
inline f32x4 f32x4_add(f32x4 a, f32x4 b) { return _mm_add_ps(a, b); }
inline f32x4 f32x4_sub(f32x4 a, f32x4 b) { return _mm_sub_ps(a, b); }
inline f32x4 f32x4_mul(f32x4 a, f32x4 b) { return _mm_mul_ps(a, b); }
inline f32x4 f32x4_div(f32x4 a, f32x4 b) { return _mm_div_ps(a, b); }
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return _mm_max_ps(a, b); }
inline f32x4 f32x4_sqrt(f32x4 a) { return _mm_sqrt_ps(a); }
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) { return _mm_cmpgt_ps(a, b); }
inline f32x4 f32x4_gt_mask(f32x4 a, f32x4 b) { return f32x4_gt(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) { return _mm_and_ps(a, b); }

#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>

using f32x4 = float32x4_t;

inline f32x4 f32x4_load(const float* p) { return vld1q_f32(p); }
inline void f32x4_store(float* p, f32x4 v) { vst1q_f32(p, v); }
inline f32x4 f32x4_splat(float x) { return vdupq_n_f32(x); }
inline f32x4 f32x4_add(f32x4 a, f32x4 b) { return vaddq_f32(a, b); }
inline f32x4 f32x4_sub(f32x4 a, f32x4 b) { return vsubq_f32(a, b); }
inline f32x4 f32x4_mul(f32x4 a, f32x4 b) { return vmulq_f32(a, b); }
inline f32x4 f32x4_div(f32x4 a, f32x4 b) {
#if defined(__aarch64__)
    return vdivq_f32(a, b);
#else
    float num[4];
    float den[4];
    float out[4];
    vst1q_f32(num, a);
    vst1q_f32(den, b);
    for (int i = 0; i < 4; ++i) out[i] = num[i] / den[i];
    return vld1q_f32(out);
#endif
}
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return vmaxq_f32(a, b); }
inline f32x4 f32x4_sqrt(f32x4 a) {
#if defined(__aarch64__)
    return vsqrtq_f32(a);
#else
    float in[4];
    float out[4];
    vst1q_f32(in, a);
    for (int i = 0; i < 4; ++i) out[i] = std::sqrt(in[i]);
    return vld1q_f32(out);
#endif
}
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) {
    return vreinterpretq_f32_u32(vcgtq_f32(a, b));
}
inline f32x4 f32x4_gt_mask(f32x4 a, f32x4 b) { return f32x4_gt(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) {
    return vreinterpretq_f32_u32(vandq_u32(vreinterpretq_u32_f32(a),
                                           vreinterpretq_u32_f32(b)));
}

#else
struct f32x4 {
    float v[4];
};

inline f32x4 f32x4_load(const float* p) {
    f32x4 r;
    r.v[0] = p[0];
    r.v[1] = p[1];
    r.v[2] = p[2];
    r.v[3] = p[3];
    return r;
}
inline void f32x4_store(float* p, f32x4 v) {
    p[0] = v.v[0];
    p[1] = v.v[1];
    p[2] = v.v[2];
    p[3] = v.v[3];
}
inline f32x4 f32x4_splat(float x) { return {x, x, x, x}; }
inline f32x4 f32x4_add(f32x4 a, f32x4 b) {
    return {a.v[0] + b.v[0], a.v[1] + b.v[1], a.v[2] + b.v[2], a.v[3] + b.v[3]};
}
inline f32x4 f32x4_sub(f32x4 a, f32x4 b) {
    return {a.v[0] - b.v[0], a.v[1] - b.v[1], a.v[2] - b.v[2], a.v[3] - b.v[3]};
}
inline f32x4 f32x4_mul(f32x4 a, f32x4 b) {
    return {a.v[0] * b.v[0], a.v[1] * b.v[1], a.v[2] * b.v[2], a.v[3] * b.v[3]};
}
inline f32x4 f32x4_div(f32x4 a, f32x4 b) {
    return {a.v[0] / b.v[0], a.v[1] / b.v[1], a.v[2] / b.v[2], a.v[3] / b.v[3]};
}
inline f32x4 f32x4_max(f32x4 a, f32x4 b) {
    return {
        a.v[0] > b.v[0] ? a.v[0] : b.v[0],
        a.v[1] > b.v[1] ? a.v[1] : b.v[1],
        a.v[2] > b.v[2] ? a.v[2] : b.v[2],
        a.v[3] > b.v[3] ? a.v[3] : b.v[3],
    };
}
inline f32x4 f32x4_sqrt(f32x4 a) {
    return {std::sqrt(a.v[0]), std::sqrt(a.v[1]), std::sqrt(a.v[2]), std::sqrt(a.v[3])};
}
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) {
    f32x4 r;
    for (int i = 0; i < 4; ++i) {
        const unsigned bits = a.v[i] > b.v[i] ? 0xffffffffu : 0u;
        float f;
        static_assert(sizeof(float) == sizeof(unsigned), "mask size");
        __builtin_memcpy(&f, &bits, sizeof(f));
        r.v[i] = f;
    }
    return r;
}
inline f32x4 f32x4_gt_mask(f32x4 a, f32x4 b) { return f32x4_gt(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) {
    f32x4 r;
    for (int i = 0; i < 4; ++i) {
        unsigned ua, ub;
        __builtin_memcpy(&ua, &a.v[i], sizeof(ua));
        __builtin_memcpy(&ub, &b.v[i], sizeof(ub));
        ua &= ub;
        __builtin_memcpy(&r.v[i], &ua, sizeof(ua));
    }
    return r;
}

#endif

inline float f32x4_hmax(f32x4 v) {
    float t[4];
    f32x4_store(t, v);
    float m = t[0];
    if (t[1] > m) m = t[1];
    if (t[2] > m) m = t[2];
    if (t[3] > m) m = t[3];
    return m;
}

#endif  // WATERSHED_SIMDF32_H
