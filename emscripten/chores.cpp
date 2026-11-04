/**
 * chores.cpp — generic grid/image helpers for gpu-chores (WASM lane).
 *
 * Formulas must match src/rendering/gpuChores/cpuMath.ts. Domain hydrology
 * stays in swe.cpp / forces.cpp.
 */

#include "chores.h"

#include "simdf32.h"
#include "swe.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <span>
#include <vector>

namespace {

constexpr int HISTOGRAM_BINS = 256;
constexpr double BT709_R = 0.2126;
constexpr double BT709_G = 0.7152;
constexpr double BT709_B = 0.0722;
constexpr float BLUR_TAP = 0.25f;
constexpr float BLUR_CENTER = 0.5f;

/** A flat element count from JS: [0, WS_MAX_ELEMENTS]. */
bool validCount(int count) {
    return count >= 0 && count <= WS_MAX_ELEMENTS;
}

/** A grid extent from JS: [1, SWE_MAX_GRID_EXTENT]. */
bool validExtent(int extent) {
    return extent > 0 && extent <= SWE_MAX_GRID_EXTENT;
}

int binScalar(float value, float rangeMin, float rangeMax) {
    const float span = rangeMax - rangeMin;
    if (!(span > 0.f)) return 0;
    const float t = (value - rangeMin) / span * static_cast<float>(HISTOGRAM_BINS);
    // Clamp before the cast (#502, chores_fuzz): a value far outside a narrow
    // range makes t overflow int, and a float → int cast out of range is UB.
    // Same bins as floor-then-clamp (cpuMath.ts); NaN t lands in bin 0.
    if (!(t >= 0.f)) return 0;
    if (t >= static_cast<float>(HISTOGRAM_BINS)) return HISTOGRAM_BINS - 1;
    return static_cast<int>(std::floor(t));
}

float sampleClamped(std::span<const float> src, int width, int height, int x, int y) {
    const int cx = x < 0 ? 0 : (x >= width ? width - 1 : x);
    const int cy = y < 0 ? 0 : (y >= height ? height - 1 : y);
    const float v = src[static_cast<std::size_t>(cy) * static_cast<std::size_t>(width) + static_cast<std::size_t>(cx)];
    return std::isfinite(v) ? v : 0.f;
}

/** packSurfaceField's bed when the caller passes none. Grow-only, never written past assign. */
std::vector<float> g_flatBed;

/** blurSeparableF32's horizontal pass. Grow-only: a HUD-sized blur allocates once per session. */
std::vector<float> g_blurScratch;

}  // namespace

// Every entry point returns WS_REJECTED, writing nothing, on a null pointer or
// an out-of-range count / extent (#502, #533) — the sentinels in WASM.md. A
// count of 0 is valid input (empty grid → zeros / an all-zero histogram).

int reduceF32Grid(uintptr_t src, int count, uintptr_t out3) {
    if (out3 == 0 || !validCount(count) || (count > 0 && src == 0)) return WS_REJECTED;
    const std::span<const float> s = heapSpan<const float>(src, static_cast<std::size_t>(count));
    const std::span<float> o = heapSpan<float>(out3, 3);
    float mn = 3.402823466e+38f;
    float mx = -3.402823466e+38f;
    double sum = 0.0;
    int n = 0;
    for (const float v : s) {
        if (!std::isfinite(v)) continue;
        ++n;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        sum += static_cast<double>(v);
    }
    if (n == 0) {
        o[0] = 0.f;
        o[1] = 0.f;
        o[2] = 0.f;
        return WS_OK;
    }
    o[0] = mn;
    o[1] = mx;
    o[2] = static_cast<float>(sum / static_cast<double>(n));
    return WS_OK;
}

int histogramF32(uintptr_t src, int count, float rangeMin, float rangeMax, uintptr_t binsPtr) {
    if (binsPtr == 0 || !validCount(count) || (count > 0 && src == 0)) return WS_REJECTED;
    const std::span<std::uint32_t> bins = heapSpan<std::uint32_t>(binsPtr, HISTOGRAM_BINS);
    std::fill(bins.begin(), bins.end(), 0u);
    for (const float v : heapSpan<const float>(src, static_cast<std::size_t>(count))) {
        if (!std::isfinite(v)) continue;
        bins[static_cast<std::size_t>(binScalar(v, rangeMin, rangeMax))] += 1u;
    }
    return WS_OK;
}

int lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr) {
    if (binsPtr == 0 || !validCount(pixelCount) || (pixelCount > 0 && rgba == 0)) return WS_REJECTED;
    const std::span<std::uint32_t> bins = heapSpan<std::uint32_t>(binsPtr, HISTOGRAM_BINS);
    std::fill(bins.begin(), bins.end(), 0u);
    const std::span<const std::uint8_t> px =
        heapSpan<const std::uint8_t>(rgba, static_cast<std::size_t>(pixelCount) * 4u);
    for (std::size_t i = 0; i < px.size(); i += 4) {
        const double r = px[i];
        const double g = px[i + 1];
        const double b = px[i + 2];
        const double y = (BT709_R * r + BT709_G * g + BT709_B * b) / 255.0;
        if (!std::isfinite(y)) continue;
        int bin = static_cast<int>(std::floor(y * HISTOGRAM_BINS));
        if (bin < 0) bin = 0;
        if (bin > HISTOGRAM_BINS - 1) bin = HISTOGRAM_BINS - 1;
        bins[static_cast<std::size_t>(bin)] += 1u;
    }
    return WS_OK;
}

int downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH) {
    if (src == 0 || dst == 0 || !validExtent(srcW) || !validExtent(srcH)) return WS_REJECTED;
    // A non-positive destination extent is one cell (the cpuMath.ts contract);
    // an oversized one is rejected like the source.
    const int width = dstW < 1 ? 1 : dstW;
    const int height = dstH < 1 ? 1 : dstH;
    if (!validExtent(width) || !validExtent(height)) return WS_REJECTED;
    const std::span<const float> s = heapSpan<const float>(src, static_cast<std::size_t>(srcW) * static_cast<std::size_t>(srcH));
    const std::span<float> d = heapPlane(dst, width, height);
    for (int dy = 0; dy < height; ++dy) {
        int y0 = (dy * srcH) / height;
        int y1 = ((dy + 1) * srcH) / height;
        if (y1 <= y0) y1 = srcH < y0 + 1 ? srcH : y0 + 1;
        for (int dx = 0; dx < width; ++dx) {
            int x0 = (dx * srcW) / width;
            int x1 = ((dx + 1) * srcW) / width;
            if (x1 <= x0) x1 = srcW < x0 + 1 ? srcW : x0 + 1;
            double sum = 0.0;
            int n = 0;
            for (int y = y0; y < y1; ++y) {
                for (int x = x0; x < x1; ++x) {
                    const float v = s[static_cast<std::size_t>(y) * static_cast<std::size_t>(srcW) + static_cast<std::size_t>(x)];
                    if (!std::isfinite(v)) continue;
                    sum += static_cast<double>(v);
                    ++n;
                }
            }
            d[static_cast<std::size_t>(dy) * static_cast<std::size_t>(width) + static_cast<std::size_t>(dx)] =
                n > 0 ? static_cast<float>(sum / static_cast<double>(n)) : 0.f;
        }
    }
    return WS_OK;
}

int blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height) {
    if (src == 0 || dst == 0 || !validExtent(width) || !validExtent(height)) return WS_REJECTED;
    const std::span<const float> s = heapPlane(src, width, height);
    const std::span<float> d = heapPlane(dst, width, height);
    // Grow-only scratch (#533), like every other kernel: this was the one
    // per-call malloc, with a silent "copy src to dst" branch on OOM.
    if (g_blurScratch.size() < s.size()) g_blurScratch.resize(s.size());
    const std::span<float> tmp = std::span<float>(g_blurScratch).first(s.size());
    const auto at = [width](int x, int y) {
        return static_cast<std::size_t>(y) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x);
    };
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            tmp[at(x, y)] =
                sampleClamped(s, width, height, x - 1, y) * BLUR_TAP +
                sampleClamped(s, width, height, x, y) * BLUR_CENTER +
                sampleClamped(s, width, height, x + 1, y) * BLUR_TAP;
        }
    }
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            d[at(x, y)] =
                sampleClamped(tmp, width, height, x, y - 1) * BLUR_TAP +
                sampleClamped(tmp, width, height, x, y) * BLUR_CENTER +
                sampleClamped(tmp, width, height, x, y + 1) * BLUR_TAP;
        }
    }
    return WS_OK;
}

namespace {

/** One cell of packSurfaceField, scalar: the reference the 4-wide groups match bit for bit. */
void packCell(std::span<const float> h, std::span<const float> u, std::span<const float> w,
              std::span<const float> b, std::span<float> out, int width, int height,
              int x, int z, float H, float dx) {
    const std::size_t i = static_cast<std::size_t>(z) * static_cast<std::size_t>(width) + static_cast<std::size_t>(x);
    const float depth = std::max(0.f, (H + h[i]) - b[i]);
    float div = 0.f;
    if (depth > SWE_DRY_DEPTH) {
        const int xLo = x > 0 ? x - 1 : x;
        const int xHi = x < width - 1 ? x + 1 : x;
        const int zLo = z > 0 ? z - 1 : z;
        const int zHi = z < height - 1 ? z + 1 : z;
        const float spanX = static_cast<float>(xHi - xLo) * dx;
        const float spanZ = static_cast<float>(zHi - zLo) * dx;
        const std::size_t row = static_cast<std::size_t>(z) * static_cast<std::size_t>(width);
        const std::size_t col = static_cast<std::size_t>(x);
        if (spanX > 0.f) div += (u[row + static_cast<std::size_t>(xHi)] - u[row + static_cast<std::size_t>(xLo)]) / spanX;
        if (spanZ > 0.f) {
            div += (w[static_cast<std::size_t>(zHi) * static_cast<std::size_t>(width) + col]
                    - w[static_cast<std::size_t>(zLo) * static_cast<std::size_t>(width) + col]) / spanZ;
        }
    }
    const std::span<float> o = out.subspan(i * 4, 4);
    o[0] = u[i];
    o[1] = w[i];
    o[2] = depth;
    o[3] = div;
}

}  // namespace

int packSurfaceField(uintptr_t hPtr, uintptr_t uPtr, uintptr_t wPtr, uintptr_t bPtr,
                     int width, int height, float H, float dx, uintptr_t outRgba) {
    if (hPtr == 0 || uPtr == 0 || wPtr == 0 || outRgba == 0) return WS_REJECTED;
    if (!validExtent(width) || !validExtent(height)) return WS_REJECTED;
    if (!std::isfinite(H) || !(dx > 0.f) || !std::isfinite(dx)) return WS_REJECTED;
    const std::size_t n = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    const std::span<const float> h = heapPlane(hPtr, width, height);
    const std::span<const float> u = heapPlane(uPtr, width, height);
    const std::span<const float> w = heapPlane(wPtr, width, height);
    if (bPtr == 0 && g_flatBed.size() < n) g_flatBed.assign(n, 0.f);
    const std::span<const float> b = bPtr != 0
        ? std::span<const float>(heapPlane(bPtr, width, height))
        : std::span<const float>(g_flatBed).first(n);
    const std::span<float> out = heapSpan<float>(outRgba, n * 4);

    const f32x4 vZero = f32x4_splat(0.f);
    const f32x4 vH = f32x4_splat(H);
    const f32x4 vDry = f32x4_splat(SWE_DRY_DEPTH);
    // Interior columns [1, width − 2] have the full 2·dx span; the border
    // columns (and every column of a row-extent-1 grid) go through packCell.
    const f32x4 vSpanX = f32x4_splat(2.f * dx);
    const int interior = width - 2;
    std::array<float, 4> lu{};
    std::array<float, 4> lw{};
    std::array<float, 4> ld{};
    std::array<float, 4> ldiv{};
    for (int z = 0; z < height; ++z) {
        const int zLo = z > 0 ? z - 1 : z;
        const int zHi = z < height - 1 ? z + 1 : z;
        const float spanZ = static_cast<float>(zHi - zLo) * dx;
        const bool hasZ = spanZ > 0.f;
        const f32x4 vSpanZ = f32x4_splat(hasZ ? spanZ : 1.f);
        const std::size_t row = static_cast<std::size_t>(z) * static_cast<std::size_t>(width);
        const std::size_t rowLo = static_cast<std::size_t>(zLo) * static_cast<std::size_t>(width);
        const std::size_t rowHi = static_cast<std::size_t>(zHi) * static_cast<std::size_t>(width);
        const auto group = [&](int x) {
            const std::size_t i = row + static_cast<std::size_t>(x);
            const std::size_t c = static_cast<std::size_t>(x);
            const f32x4 vu = f32x4_load(&u[i]);
            const f32x4 vw = f32x4_load(&w[i]);
            const f32x4 depth = f32x4_max(vZero, f32x4_sub(f32x4_add(vH, f32x4_load(&h[i])), f32x4_load(&b[i])));
            // div starts at +0 and adds each axis, as packCell does (0 + −0 is +0).
            f32x4 div = f32x4_add(vZero, f32x4_div(f32x4_sub(f32x4_load(&u[i + 1]), f32x4_load(&u[i - 1])), vSpanX));
            if (hasZ) {
                div = f32x4_add(div, f32x4_div(f32x4_sub(f32x4_load(&w[rowHi + c]), f32x4_load(&w[rowLo + c])), vSpanZ));
            }
            div = f32x4_select(f32x4_gt(depth, vDry), div, vZero);
            f32x4_store(lu.data(), vu);
            f32x4_store(lw.data(), vw);
            f32x4_store(ld.data(), depth);
            f32x4_store(ldiv.data(), div);
            const std::span<float> o = out.subspan(i * 4, 16);
            for (std::size_t k = 0; k < 4; ++k) {
                o[4 * k] = lu[k];
                o[4 * k + 1] = lw[k];
                o[4 * k + 2] = ld[k];
                o[4 * k + 3] = ldiv[k];
            }
        };
        int x = 1;
        if (interior >= 4) {
            // Overlapping last group on a ragged width: it rewrites cells from
            // the same inputs, so the bytes are the same.
            for (; x + 4 <= width - 1; x += 4) group(x);
            if (x < width - 1) group(width - 5);
            x = width - 1;
        }
        for (; x < width - 1; ++x) packCell(h, u, w, b, out, width, height, x, z, H, dx);
        packCell(h, u, w, b, out, width, height, 0, z, H, dx);
        if (width > 1) packCell(h, u, w, b, out, width, height, width - 1, z, H, dx);
    }
    return WS_OK;
}
