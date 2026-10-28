/**
 * swe_fuzz.cpp — libFuzzer target over the SWE entry points (#467, host only).
 *
 * The C ABI hands the solver raw heap pointers and a width x height that come
 * from JavaScript. This target drives stepShallowWater[Inflow], applySWEEvent
 * and scrollShallowWater with random-but-valid grids — planes allocated at
 * exactly width * height, finite fields in a physical range, random extents
 * (ragged widths included), beds, events and shifts — under ASan + UBSan, so
 * an out-of-bounds index or an overflow in the vector / remainder paths is a
 * crash, and a non-finite field is reported too. Scalars (dt, g, dx, H, the
 * edge stage, event and inflow values) are a NaN, ±inf, denormal or ±0 one
 * draw in four (fuzz::Input::special): no scalar may poison a finite field.
 *
 *   pnpm test:native:fuzz              # 60 s, as CI runs it
 *   emscripten/build-fuzz/watershed_swe_fuzz -max_total_time=600
 */

#include "fuzz_input.h"
#include "swe.h"

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

using fuzz::Input;
using fuzz::ptr;

void requireFinite(const std::vector<float>& v, const char* name, int step) {
    for (std::size_t i = 0; i < v.size(); ++i) {
        if (!std::isfinite(v[i])) {
            std::fprintf(stderr, "non-finite %s[%zu] = %g after op %d from a finite field\n", name, i, v[i], step);
            std::abort();
        }
    }
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    Input in{data, size};
    const int width = in.pick(1, 70);
    const int height = in.pick(1, 50);
    const std::size_t n = static_cast<std::size_t>(width) * static_cast<std::size_t>(height);
    const float H = in.range(0.2f, 3.f);
    const float dx = in.range(0.1f, 2.f);
    const bool withBed = (in.u32() & 1u) != 0;

    // Fields come from a seeded generator, not raw bytes: a short input would
    // otherwise be all zeros past its end (h = -H, every cell dry) and never
    // reach the flux code.
    uint32_t state = in.u32() | 1u;
    const auto next = [&state](float lo, float hi) {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        return lo + (hi - lo) * (static_cast<float>(state & 0xffffffu) / static_cast<float>(0xffffff));
    };
    const float dryShare = in.range(0.f, 1.f);  // how much of the bed rises above the surface
    std::vector<float> h(n), u(n), w(n), b(n);
    for (std::size_t i = 0; i < n; ++i) {
        b[i] = withBed ? next(0.f, H * (1.f + dryShare)) : 0.f;
        h[i] = next(-0.5f * H, 0.5f * H);
        u[i] = next(-5.f, 5.f);
        w[i] = next(-5.f, 5.f);
    }
    const uintptr_t bPtr = withBed ? ptr(b) : 0;
    reserveShallowWaterScratch(width, height);

    const int ops = in.pick(1, 12);
    for (int op = 0; op < ops; ++op) {
        switch (in.u32() % 4u) {
            case 0:
                stepShallowWater(ptr(h), ptr(u), ptr(w), bPtr, width, height,
                                 in.scalar(1e-4f, 0.1f), in.orSpecial(9.80665f), in.orSpecial(dx),
                                 in.orSpecial(H));
                break;
            case 1:
                stepShallowWaterInflow(ptr(h), ptr(u), ptr(w), bPtr, width, height,
                                       in.scalar(1e-4f, 0.1f), in.orSpecial(9.80665f), in.orSpecial(dx),
                                       in.orSpecial(H), in.scalar(-0.9f * H, 2.f * H));
                break;
            case 2:
                applySWEEvent(ptr(h), ptr(u), ptr(w), bPtr, width, height, in.orSpecial(dx),
                              in.scalar(-50.f, 50.f), in.scalar(-50.f, 50.f), in.orSpecial(H), in.pick(0, 4),
                              in.scalar(-60.f, 60.f), in.scalar(-60.f, 60.f), in.scalar(0.f, 20.f),
                              in.scalar(0.f, 3.f), in.scalar(0.f, 0.1f));
                break;
            default:
                scrollShallowWater(ptr(h), ptr(u), ptr(w), bPtr, width, height,
                                   in.pick(-2 * width, 2 * width), in.pick(-2 * height, 2 * height),
                                   in.scalar(-H, H), in.scalar(-2.f, 2.f), in.scalar(-2.f, 2.f));
                break;
        }
        requireFinite(h, "h", op);
        requireFinite(u, "u", op);
        requireFinite(w, "w", op);
        requireFinite(b, "b", op);
    }
    return 0;
}
