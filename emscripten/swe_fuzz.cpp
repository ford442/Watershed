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

#include "common.h"
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

std::size_t nonFinite(const std::vector<float>& v) {
    std::size_t c = 0;
    for (const float x : v) c += std::isfinite(x) ? 0u : 1u;
    return c;
}

/**
 * The returned dt (#533): 0 for a rejected step, else in [0, dt] — a valid
 * but degenerate scalar (a denormal dx or g) can make the CFL limit itself 0.
 */
void requireConsumed(float consumed, float dt, float g, float dxs, float Hs, int step) {
    const bool valid = dt > 0.f && std::isfinite(dt) && g > 0.f && std::isfinite(g)
        && dxs > 0.f && std::isfinite(dxs) && Hs > 0.f && std::isfinite(Hs);
    const bool ok = valid ? (consumed >= 0.f && consumed <= dt) : consumed == 0.f;
    if (!ok) {
        std::fprintf(stderr, "op %d: step(dt %g) returned %g (valid %d)\n", step, dt, consumed, valid ? 1 : 0);
        std::abort();
    }
    // The damping factor for any dt the fuzzer draws is in (0, 1].
    const float damp = sweExpNeg(dt * DAMPING_COEFF);
    if (!(damp > 0.f && damp <= 1.f)) {
        std::fprintf(stderr, "op %d: damp(dt %g) = %g outside (0, 1]\n", step, dt, damp);
        std::abort();
    }
}

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

    // Non-finite cells currently in the field: 0 until a poison op (#533)
    // writes one, and never allowed to grow after that — the lift reads a
    // NaN / inf η, u, w as 0, so the next valid step heals it.
    std::size_t poisoned = 0;
    const auto field = [&]() { return nonFinite(h) + nonFinite(u) + nonFinite(w); };
    const int ops = in.pick(1, 12);
    for (int op = 0; op < ops; ++op) {
        // dt reaches 30 s: far past 4 CFL sub-steps, and the 25 s barely-wet
        // step that drove the old linear damping negative.
        switch (in.u32() % 5u) {
            case 0: {
                const float dt = in.scalar(1e-4f, in.coin() ? 0.1f : 30.f);
                const float g = in.orSpecial(9.80665f);
                const float dxs = in.orSpecial(dx);
                const float Hs = in.orSpecial(H);
                requireConsumed(stepShallowWater(ptr(h), ptr(u), ptr(w), bPtr, width, height, dt, g, dxs, Hs),
                                dt, g, dxs, Hs, op);
                break;
            }
            case 1: {
                const float dt = in.scalar(1e-4f, in.coin() ? 0.1f : 30.f);
                const float g = in.orSpecial(9.80665f);
                const float dxs = in.orSpecial(dx);
                const float Hs = in.orSpecial(H);
                requireConsumed(stepShallowWaterInflow(ptr(h), ptr(u), ptr(w), bPtr, width, height, dt, g, dxs, Hs,
                                                       in.scalar(-0.9f * H, 2.f * H)),
                                dt, g, dxs, Hs, op);
                break;
            }
            case 4: {
                // Poison one cell of η, u or w with NaN / ±inf, as an unchecked
                // JS door (addSurface, a splash) could.
                const std::size_t cell = in.u32() % n;
                std::vector<float>& plane = in.pick(0, 2) == 0 ? h : (in.coin() ? u : w);
                const uint32_t kind = in.u32() % 3u;
                plane[cell] = kind == 0 ? __builtin_nanf("") : (kind == 1 ? __builtin_inff() : -__builtin_inff());
                poisoned = field();
                continue;
            }
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
        requireFinite(b, "b", op);
        if (poisoned > 0) {
            const std::size_t now = field();
            if (now > poisoned) {
                std::fprintf(stderr, "op %d: non-finite cells grew %zu -> %zu\n", op, poisoned, now);
                std::abort();
            }
            poisoned = now;
            continue;
        }
        requireFinite(h, "h", op);
        requireFinite(u, "u", op);
        requireFinite(w, "w", op);
    }
    return 0;
}
