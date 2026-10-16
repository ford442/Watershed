/**
 * simdf32.h — portable 4-wide float SIMD for SWE / particle inner loops.
 *
 * wasm_simd128 on Emscripten (-msimd128), SSE2 on x86_64 host, NEON on ARM.
 * Scalar 4-wide fallback otherwise. Algorithm identity is the contract: every
 * lane computes exactly the scalar expression it replaces, in the same order,
 * so the vector and scalar paths in swe.cpp agree bit for bit on the host.
 *
 * min / max follow std::min / std::max on every backend (#467):
 *
 *   f32x4_max(a, b) = a < b ? b : a        f32x4_min(a, b) = b < a ? b : a
 *
 * That is wasm's pmax / pmin, SSE's _mm_max_ps(b, a) / _mm_min_ps(b, a), and a
 * compare + bit-select on NEON. In particular a NaN in `b` is ignored, so one
 * NaN velocity no longer poisons the WASM CFL max while the host's stays
 * finite (wasm_f32x4_max propagates NaN; _mm_max_ps does not).
 *
 * Masks are f32x4 values with all bits set (true) or clear (false) per lane,
 * as the comparisons return them.
 */

#ifndef WATERSHED_SIMDF32_H
#define WATERSHED_SIMDF32_H

#include <cmath>
#include <cstring>

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
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return wasm_f32x4_pmax(a, b); }
inline f32x4 f32x4_min(f32x4 a, f32x4 b) { return wasm_f32x4_pmin(a, b); }
inline f32x4 f32x4_sqrt(f32x4 a) { return wasm_f32x4_sqrt(a); }
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) { return wasm_f32x4_gt(a, b); }
inline f32x4 f32x4_ge(f32x4 a, f32x4 b) { return wasm_f32x4_ge(a, b); }
inline f32x4 f32x4_lt(f32x4 a, f32x4 b) { return wasm_f32x4_lt(a, b); }
inline f32x4 f32x4_le(f32x4 a, f32x4 b) { return wasm_f32x4_le(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) { return wasm_v128_and(a, b); }
inline f32x4 f32x4_or(f32x4 a, f32x4 b) { return wasm_v128_or(a, b); }
/** mask ? a : b, per lane. */
inline f32x4 f32x4_select(f32x4 mask, f32x4 a, f32x4 b) { return wasm_v128_bitselect(a, b, mask); }

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
// _mm_max_ps(x, y) = x > y ? x : y, so swapping the operands gives a < b ? b : a.
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return _mm_max_ps(b, a); }
inline f32x4 f32x4_min(f32x4 a, f32x4 b) { return _mm_min_ps(b, a); }
inline f32x4 f32x4_sqrt(f32x4 a) { return _mm_sqrt_ps(a); }
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) { return _mm_cmpgt_ps(a, b); }
inline f32x4 f32x4_ge(f32x4 a, f32x4 b) { return _mm_cmpge_ps(a, b); }
inline f32x4 f32x4_lt(f32x4 a, f32x4 b) { return _mm_cmplt_ps(a, b); }
inline f32x4 f32x4_le(f32x4 a, f32x4 b) { return _mm_cmple_ps(a, b); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) { return _mm_and_ps(a, b); }
inline f32x4 f32x4_or(f32x4 a, f32x4 b) { return _mm_or_ps(a, b); }
inline f32x4 f32x4_select(f32x4 mask, f32x4 a, f32x4 b) {
    return _mm_or_ps(_mm_and_ps(mask, a), _mm_andnot_ps(mask, b));
}

#elif defined(__ARM_NEON) || defined(__ARM_NEON__)
#include <arm_neon.h>

using f32x4 = float32x4_t;

inline uint32x4_t f32x4_bits(f32x4 v) { return vreinterpretq_u32_f32(v); }
inline f32x4 f32x4_from_bits(uint32x4_t v) { return vreinterpretq_f32_u32(v); }

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
inline f32x4 f32x4_max(f32x4 a, f32x4 b) { return vbslq_f32(vcltq_f32(a, b), b, a); }
inline f32x4 f32x4_min(f32x4 a, f32x4 b) { return vbslq_f32(vcltq_f32(b, a), b, a); }
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
inline f32x4 f32x4_gt(f32x4 a, f32x4 b) { return f32x4_from_bits(vcgtq_f32(a, b)); }
inline f32x4 f32x4_ge(f32x4 a, f32x4 b) { return f32x4_from_bits(vcgeq_f32(a, b)); }
inline f32x4 f32x4_lt(f32x4 a, f32x4 b) { return f32x4_from_bits(vcltq_f32(a, b)); }
inline f32x4 f32x4_le(f32x4 a, f32x4 b) { return f32x4_from_bits(vcleq_f32(a, b)); }
inline f32x4 f32x4_and(f32x4 a, f32x4 b) {
    return f32x4_from_bits(vandq_u32(f32x4_bits(a), f32x4_bits(b)));
}
inline f32x4 f32x4_or(f32x4 a, f32x4 b) {
    return f32x4_from_bits(vorrq_u32(f32x4_bits(a), f32x4_bits(b)));
}
inline f32x4 f32x4_select(f32x4 mask, f32x4 a, f32x4 b) { return vbslq_f32(f32x4_bits(mask), a, b); }

#else
struct f32x4 {
    float v[4];
};

namespace simdf32_detail {
inline unsigned bits(float f) {
    unsigned u;
    std::memcpy(&u, &f, sizeof(u));
    return u;
}
inline float from_bits(unsigned u) {
    float f;
    std::memcpy(&f, &u, sizeof(f));
    return f;
}
inline float mask(bool b) { return from_bits(b ? 0xffffffffu : 0u); }
}  // namespace simdf32_detail

inline f32x4 f32x4_load(const float* p) { return {{p[0], p[1], p[2], p[3]}}; }
inline void f32x4_store(float* p, f32x4 v) {
    p[0] = v.v[0];
    p[1] = v.v[1];
    p[2] = v.v[2];
    p[3] = v.v[3];
}
inline f32x4 f32x4_splat(float x) { return {{x, x, x, x}}; }

#define WATERSHED_F32X4_LANEWISE(name, expr)                    \
    inline f32x4 name(f32x4 a, f32x4 b) {                       \
        f32x4 r;                                                \
        for (int i = 0; i < 4; ++i) {                           \
            const float x = a.v[i];                             \
            const float y = b.v[i];                             \
            r.v[i] = (expr);                                    \
        }                                                       \
        return r;                                               \
    }
WATERSHED_F32X4_LANEWISE(f32x4_add, x + y)
WATERSHED_F32X4_LANEWISE(f32x4_sub, x - y)
WATERSHED_F32X4_LANEWISE(f32x4_mul, x * y)
WATERSHED_F32X4_LANEWISE(f32x4_div, x / y)
WATERSHED_F32X4_LANEWISE(f32x4_max, x < y ? y : x)
WATERSHED_F32X4_LANEWISE(f32x4_min, y < x ? y : x)
WATERSHED_F32X4_LANEWISE(f32x4_gt, simdf32_detail::mask(x > y))
WATERSHED_F32X4_LANEWISE(f32x4_ge, simdf32_detail::mask(x >= y))
WATERSHED_F32X4_LANEWISE(f32x4_lt, simdf32_detail::mask(x < y))
WATERSHED_F32X4_LANEWISE(f32x4_le, simdf32_detail::mask(x <= y))
WATERSHED_F32X4_LANEWISE(f32x4_and,
    simdf32_detail::from_bits(simdf32_detail::bits(x) & simdf32_detail::bits(y)))
WATERSHED_F32X4_LANEWISE(f32x4_or,
    simdf32_detail::from_bits(simdf32_detail::bits(x) | simdf32_detail::bits(y)))
#undef WATERSHED_F32X4_LANEWISE

inline f32x4 f32x4_sqrt(f32x4 a) {
    return {{std::sqrt(a.v[0]), std::sqrt(a.v[1]), std::sqrt(a.v[2]), std::sqrt(a.v[3])}};
}
inline f32x4 f32x4_select(f32x4 mask, f32x4 a, f32x4 b) {
    f32x4 r;
    for (int i = 0; i < 4; ++i) {
        const unsigned m = simdf32_detail::bits(mask.v[i]);
        r.v[i] = simdf32_detail::from_bits((simdf32_detail::bits(a.v[i]) & m)
                                           | (simdf32_detail::bits(b.v[i]) & ~m));
    }
    return r;
}

#endif

/** Kept for existing callers; the same mask f32x4_gt returns. */
inline f32x4 f32x4_gt_mask(f32x4 a, f32x4 b) { return f32x4_gt(a, b); }

/** Horizontal max with the same NaN rule as f32x4_max (a NaN lane is skipped). */
inline float f32x4_hmax(f32x4 v) {
    float t[4];
    f32x4_store(t, v);
    float m = t[0];
    if (m < t[1]) m = t[1];
    if (m < t[2]) m = t[2];
    if (m < t[3]) m = t[3];
    return m;
}

#endif  // WATERSHED_SIMDF32_H
