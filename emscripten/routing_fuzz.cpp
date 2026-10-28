/**
 * routing_fuzz.cpp — libFuzzer target over channel routing (host only; split
 * out of forces_fuzz.cpp).
 *
 * Chain arrays are allocated at exactly nSeg (storage nSeg *
 * ROUTING_SUBREACHES); nSeg is sometimes non-positive or past
 * ROUTING_MAX_SEGMENTS, which must be a no-op. Three kinds of input:
 *   physical  uniform in a physical range;
 *   special   physical, but one value in four is NaN, ±inf, a denormal or ±0
 *             (fuzz::Input::special) — the per-segment arrays, the head
 *             discharge, the lateral plane and dt;
 *   raw       any float bit pattern (memory safety only).
 * Physical and special input must keep storage finite and non-negative and
 * outflow finite: one NaN head discharge used to poison the chain for good.
 *
 *   pnpm test:native:fuzz              # every target, 60 s each
 *   FUZZ_TARGETS=routing pnpm test:native:fuzz
 */

#include "fuzz_input.h"
#include "routing.h"

#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

using fuzz::ptr;

void require(bool ok, const char* what) {
    if (!ok) {
        std::fprintf(stderr, "routing_fuzz: %s\n", what);
        std::abort();
    }
}

/** A chain length JS might send: usually small and valid, sometimes zero, negative or past the cap. */
int segmentCount(fuzz::Input& in) {
    switch (in.u32() % 8u) {
        case 0: return 0;
        case 1: return -in.pick(1, 1 << 20);
        case 2: return ROUTING_MAX_SEGMENTS + in.pick(1, 1 << 20);
        default: return in.pick(1, 40);
    }
}

enum class Kind : std::uint8_t { Physical, Special, Raw };

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    fuzz::Input in{data, size};
    const int nSeg = segmentCount(in);
    const bool valid = nSeg > 0 && nSeg <= ROUTING_MAX_SEGMENTS;
    const size_t n = valid ? static_cast<size_t>(nSeg) : 1;
    const Kind kind = static_cast<Kind>(in.u32() % 3u);
    const auto value = [&](float lo, float hi) {
        switch (kind) {
            case Kind::Physical: return in.range(lo, hi);
            case Kind::Special: return in.scalar(lo, hi);
            default: return in.raw();
        }
    };

    std::vector<float> lengths(n), slopes(n), widths(n), outflow(n, 7.f), lag(n, 7.f);
    std::vector<float> storage(n * ROUTING_SUBREACHES, 7.f);
    for (size_t k = 0; k < n; ++k) {
        lengths[k] = value(1.f, 300.f);
        slopes[k] = value(0.f, 0.5f);
        widths[k] = value(0.5f, 80.f);
    }
    const float q = value(0.f, 200.f);
    routeReachSteady(ptr(lengths), ptr(slopes), ptr(widths), nSeg, q, ptr(storage), ptr(outflow));
    std::vector<float> lateral(n);
    for (size_t k = 0; k < n; ++k) lateral[k] = in.coin() ? value(0.f, 50.f) : 0.f;
    const int steps = in.pick(1, 8);
    for (int s = 0; s < steps; ++s) {
        if (in.coin()) {
            routeReach(ptr(lengths), ptr(slopes), ptr(widths), nSeg, value(0.f, 400.f), value(0.01f, 30.f),
                       ptr(storage), ptr(outflow));
        } else {
            routeReachLateral(ptr(lengths), ptr(slopes), ptr(widths), nSeg, value(0.f, 400.f), ptr(lateral),
                              value(0.01f, 30.f), ptr(storage), ptr(outflow));
        }
    }
    routeReachTravelTime(ptr(lengths), ptr(slopes), ptr(widths), nSeg, q, ptr(lag));
    const RoutedEdge edge = routedEdgeState(value(0.f, 400.f), value(0.f, 400.f), value(0.2f, 3.f), value(1.f, 20.f));
    if (kind != Kind::Raw) {
        require(std::isfinite(edge.eta) && std::isfinite(edge.speed), "routedEdgeState is non-finite");
    }
    if (valid && kind != Kind::Raw) {
        for (float v : storage) require(v == 7.f || (std::isfinite(v) && v >= 0.f), "routing storage left [0, inf)");
        // Outflow is only finite, not >= 0: it is the volume balance
        // inflow * dt + (S - next), and S - next cancels in f32 when a long,
        // wide, flat reach holds ~1e6 m^3 — rounding of the storage, not a
        // conservation bug, and the routing numerics are not this fuzzer's.
        for (float v : outflow) require(std::isfinite(v), "routing outflow is non-finite");
        for (float v : lag) require(std::isfinite(v), "routing lag is non-finite");
    }
    return 0;
}
