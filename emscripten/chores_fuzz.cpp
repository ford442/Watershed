/**
 * chores_fuzz.cpp — libFuzzer target over the gpu-chores entry points (#502, host only).
 *
 * Drives reduceF32Grid / histogramF32 / lumaHistogramU8 / downsampleF32 /
 * blurSeparableF32 with buffers allocated at exactly the size the call names,
 * any float bit pattern in them (NaN, ±inf), and extents that are sometimes
 * non-positive, oversized or paired with a null pointer — the inputs JS can
 * hand the C ABI. Under ASan + UBSan an out-of-bounds read or write is a
 * crash; a rejected call must also leave its output untouched, and a reduce
 * or blur over finite input must stay finite.
 *
 *   pnpm test:native:fuzz              # every target, 60 s each
 */

#include "chores.h"
#include "fuzz_input.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

using fuzz::ptr;

constexpr float kUntouched = 7.f;

void require(bool ok, const char* what) {
    if (!ok) {
        std::fprintf(stderr, "chores_fuzz: %s\n", what);
        std::abort();
    }
}

bool untouched(const std::vector<float>& v) {
    return std::all_of(v.begin(), v.end(), [](float x) { return x == kUntouched; });
}

/** An extent JS might send: usually valid, sometimes zero, negative or past the cap. */
int extent(fuzz::Input& in) {
    switch (in.u32() % 8u) {
        case 0: return 0;
        case 1: return -in.pick(1, 1 << 20);
        case 2: return SWE_MAX_GRID_EXTENT + in.pick(1, 1 << 20);
        default: return in.pick(1, 40);
    }
}

bool validExtent(int e) { return e > 0 && e <= SWE_MAX_GRID_EXTENT; }

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    fuzz::Input in{data, size};
    const bool rawFloats = in.coin();
    fuzz::Field field{in.u32() | 1u};
    const auto value = [&] { return rawFloats ? in.raw() : field.next(-100.f, 100.f); };

    switch (in.u32() % 5u) {
        case 0: {
            const int count = in.coin() ? in.pick(0, 2000) : extent(in);
            const bool valid = count >= 0 && count <= WS_MAX_ELEMENTS;
            std::vector<float> src(valid ? static_cast<size_t>(count) : 0);
            for (float& v : src) v = value();
            std::vector<float> out(3, kUntouched);
            const bool nullSrc = in.coin() && count > 0;
            reduceF32Grid(nullSrc ? 0 : ptr(src), count, ptr(out));
            if (!valid || nullSrc) require(untouched(out), "rejected reduce wrote its output");
            else require(std::isfinite(out[0]) && std::isfinite(out[1]) && std::isfinite(out[2]),
                         "reduce produced a non-finite summary");
            break;
        }
        case 1: {
            const int count = in.coin() ? in.pick(0, 2000) : extent(in);
            const bool valid = count >= 0 && count <= WS_MAX_ELEMENTS;
            std::vector<float> src(valid ? static_cast<size_t>(count) : 0);
            for (float& v : src) v = value();
            std::vector<uint32_t> bins(256, 7u);
            histogramF32(ptr(src), count, in.raw(), in.raw(), ptr(bins));
            if (valid) {
                uint64_t total = 0;
                for (uint32_t b : bins) total += b;
                size_t finite = 0;
                for (float v : src) finite += std::isfinite(v) ? 1u : 0u;
                require(total == finite, "histogram does not count every finite value once");
            }
            break;
        }
        case 2: {
            const int pixels = in.coin() ? in.pick(0, 1000) : extent(in);
            const bool valid = pixels >= 0 && pixels <= WS_MAX_ELEMENTS;
            std::vector<uint8_t> rgba(valid ? static_cast<size_t>(pixels) * 4u : 0);
            for (uint8_t& b : rgba) b = static_cast<uint8_t>(in.u32());
            std::vector<uint32_t> bins(256, 7u);
            lumaHistogramU8(ptr(rgba), pixels, ptr(bins));
            if (valid) {
                uint64_t total = 0;
                for (uint32_t b : bins) total += b;
                require(total == static_cast<uint64_t>(pixels), "luma histogram does not count every pixel once");
            }
            break;
        }
        case 3: {
            const int sw = extent(in);
            const int sh = extent(in);
            const int dw = in.coin() ? in.pick(-3, 50) : extent(in);
            const int dh = in.coin() ? in.pick(-3, 50) : extent(in);
            const int cw = dw < 1 ? 1 : dw;
            const int ch = dh < 1 ? 1 : dh;
            const bool valid = validExtent(sw) && validExtent(sh) && validExtent(cw) && validExtent(ch);
            std::vector<float> src(validExtent(sw) && validExtent(sh) ? static_cast<size_t>(sw) * sh : 0);
            for (float& v : src) v = value();
            std::vector<float> dst(valid ? static_cast<size_t>(cw) * ch : 1, kUntouched);
            downsampleF32(ptr(src), sw, sh, ptr(dst), dw, dh);
            if (!valid) require(untouched(dst), "rejected downsample wrote its output");
            break;
        }
        default: {
            const int w = extent(in);
            const int h = extent(in);
            const bool valid = validExtent(w) && validExtent(h);
            const size_t n = valid ? static_cast<size_t>(w) * h : 0;
            std::vector<float> src(n);
            bool finite = true;
            for (float& v : src) {
                v = value();
                finite = finite && std::isfinite(v);
            }
            std::vector<float> dst(valid ? n : 1, kUntouched);
            blurSeparableF32(ptr(src), ptr(dst), w, h);
            if (!valid) require(untouched(dst), "rejected blur wrote its output");
            else if (finite) {
                for (float v : dst) require(std::isfinite(v), "blur of finite input is non-finite");
            }
            break;
        }
    }
    return 0;
}
