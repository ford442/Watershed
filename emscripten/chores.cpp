/**
 * chores.cpp — generic grid/image helpers for gpu-chores (WASM lane).
 *
 * Formulas must match src/rendering/gpuChores/cpuMath.ts. Domain hydrology
 * stays in swe.cpp / forces.cpp.
 */

#include "chores.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>

namespace {

constexpr int HISTOGRAM_BINS = 256;
constexpr double BT709_R = 0.2126;
constexpr double BT709_G = 0.7152;
constexpr double BT709_B = 0.0722;
constexpr float BLUR_TAP = 0.25f;
constexpr float BLUR_CENTER = 0.5f;

const float* asF32(uintptr_t ptr) {
    return reinterpret_cast<const float*>(ptr);
}

float* asF32Mut(uintptr_t ptr) {
    return reinterpret_cast<float*>(ptr);
}

std::uint32_t* asU32Mut(uintptr_t ptr) {
    return reinterpret_cast<std::uint32_t*>(ptr);
}

const std::uint8_t* asU8(uintptr_t ptr) {
    return reinterpret_cast<const std::uint8_t*>(ptr);
}

int binScalar(float value, float rangeMin, float rangeMax) {
    const float span = rangeMax - rangeMin;
    if (!(span > 0.f)) return 0;
    const float t = (value - rangeMin) / span * static_cast<float>(HISTOGRAM_BINS);
    int bin = static_cast<int>(std::floor(t));
    if (bin < 0) return 0;
    if (bin > HISTOGRAM_BINS - 1) return HISTOGRAM_BINS - 1;
    return bin;
}

float sampleClamped(const float* src, int width, int height, int x, int y) {
    const int cx = x < 0 ? 0 : (x >= width ? width - 1 : x);
    const int cy = y < 0 ? 0 : (y >= height ? height - 1 : y);
    const float v = src[cy * width + cx];
    return std::isfinite(v) ? v : 0.f;
}

}  // namespace

void reduceF32Grid(uintptr_t src, int count, uintptr_t out3) {
    const float* s = asF32(src);
    float* o = asF32Mut(out3);
    float mn = 3.402823466e+38f;
    float mx = -3.402823466e+38f;
    double sum = 0.0;
    int n = 0;
    for (int i = 0; i < count; ++i) {
        const float v = s[i];
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
    std::uint32_t* bins = asU32Mut(binsPtr);
    std::memset(bins, 0, HISTOGRAM_BINS * sizeof(std::uint32_t));
    const float* s = asF32(src);
    for (int i = 0; i < count; ++i) {
        const float v = s[i];
        if (!std::isfinite(v)) continue;
        bins[binScalar(v, rangeMin, rangeMax)] += 1u;
    }
}

void lumaHistogramU8(uintptr_t rgba, int pixelCount, uintptr_t binsPtr) {
    std::uint32_t* bins = asU32Mut(binsPtr);
    std::memset(bins, 0, HISTOGRAM_BINS * sizeof(std::uint32_t));
    const std::uint8_t* px = asU8(rgba);
    for (int p = 0; p < pixelCount; ++p) {
        const int i = p * 4;
        const double r = px[i];
        const double g = px[i + 1];
        const double b = px[i + 2];
        const double y = (BT709_R * r + BT709_G * g + BT709_B * b) / 255.0;
        if (!std::isfinite(y)) continue;
        int bin = static_cast<int>(std::floor(y * HISTOGRAM_BINS));
        if (bin < 0) bin = 0;
        if (bin > HISTOGRAM_BINS - 1) bin = HISTOGRAM_BINS - 1;
        bins[bin] += 1u;
    }
}

void downsampleF32(uintptr_t src, int srcW, int srcH, uintptr_t dst, int dstW, int dstH) {
    const float* s = asF32(src);
    float* d = asF32Mut(dst);
    const int width = dstW < 1 ? 1 : dstW;
    const int height = dstH < 1 ? 1 : dstH;
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
                    const float v = s[y * srcW + x];
                    if (!std::isfinite(v)) continue;
                    sum += static_cast<double>(v);
                    ++n;
                }
            }
            d[dy * width + dx] = n > 0 ? static_cast<float>(sum / static_cast<double>(n)) : 0.f;
        }
    }
}

void blurSeparableF32(uintptr_t src, uintptr_t dst, int width, int height) {
    const float* s = asF32(src);
    float* d = asF32Mut(dst);
    const std::size_t n = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    float* tmp = static_cast<float*>(std::malloc(n * sizeof(float)));
    if (!tmp) {
        std::memcpy(d, s, n * sizeof(float));
        return;
    }
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            tmp[y * width + x] =
                sampleClamped(s, width, height, x - 1, y) * BLUR_TAP +
                sampleClamped(s, width, height, x, y) * BLUR_CENTER +
                sampleClamped(s, width, height, x + 1, y) * BLUR_TAP;
        }
    }
    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            d[y * width + x] =
                sampleClamped(tmp, width, height, x, y - 1) * BLUR_TAP +
                sampleClamped(tmp, width, height, x, y) * BLUR_CENTER +
                sampleClamped(tmp, width, height, x, y + 1) * BLUR_TAP;
        }
    }
    std::free(tmp);
}
