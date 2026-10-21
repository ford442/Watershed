/**
 * chores.cpp — generic grid/image helpers for gpu-chores (WASM lane).
 *
 * Formulas must match src/rendering/gpuChores/cpuMath.ts. Domain hydrology
 * stays in swe.cpp / forces.cpp.
 */

#include "chores.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <span>

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

}  // namespace

// Every entry point returns early, writing nothing, on a null pointer or an
// out-of-range count / extent (#502) — the sentinels in WASM.md. A count of 0
// is valid input (empty grid → zeros / an all-zero histogram).

void reduceF32Grid(uintptr_t src, int count, uintptr_t out3) {
    if (out3 == 0 || !validCount(count) || (count > 0 && src == 0)) return;
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
        return;
    }
    o[0] = mn;
    o[1] = mx;
    o[2] = static_cast<float>(sum / static_cast<double>(n));
}

void histogramF32(uintptr_t src, int count, float rangeMin, float rangeMax, uintptr_t binsPtr) {
    if (binsPtr == 0 || !validCount(count) || (count > 0 && src == 0)) return;
    const std::span<std::uint32_t> bins = heapSpan<std::uint32_t>(binsPtr, HISTOGRAM_BINS);
    std::fill(bins.begin(), bins.end(), 0u);
    for (const float v : heapSpan<const float>(src, static_cast<std::size_t>(count))) {
        if (!std::isfinite(v)) continue;
        bins[static_cast<std::size_t>(binScalar(v, rangeMin, rangeMax))] += 1u;
    }
}

void lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr) {
    if (binsPtr == 0 || !validCount(pixelCount) || (pixelCount > 0 && rgba == 0)) return;
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
}

void downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH) {
    if (src == 0 || dst == 0 || !validExtent(srcW) || !validExtent(srcH)) return;
    // A non-positive destination extent is one cell (the cpuMath.ts contract);
    // an oversized one is rejected like the source.
    const int width = dstW < 1 ? 1 : dstW;
    const int height = dstH < 1 ? 1 : dstH;
    if (!validExtent(width) || !validExtent(height)) return;
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
}

void blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height) {
    if (src == 0 || dst == 0 || !validExtent(width) || !validExtent(height)) return;
    const std::span<const float> s = heapPlane(src, width, height);
    const std::span<float> d = heapPlane(dst, width, height);
    const std::size_t n = s.size();
    float* tmpPtr = static_cast<float*>(std::malloc(n * sizeof(float)));
    if (!tmpPtr) {
        std::copy(s.begin(), s.end(), d.begin());
        return;
    }
    const std::span<float> tmp{tmpPtr, n};
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
    std::free(tmpPtr);
}
