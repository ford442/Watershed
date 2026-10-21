/**
 * forces_fuzz.cpp — libFuzzer target over the per-body and per-chain entry
 * points (#502, host only): water forces (single + batch), channel routing and
 * the particle SoA.
 *
 * Buffers are allocated at exactly the size each call names; counts are
 * sometimes non-positive or past the documented caps (WATER_FORCE_MAX_SAMPLES,
 * ROUTING_MAX_SEGMENTS, PARTICLE_MAX_CAPACITY), which must be a no-op. Inputs
 * are any float bit pattern. Under ASan + UBSan an out-of-bounds access or an
 * int overflow is a crash; routing over finite physical input must stay
 * finite (storage non-negative).
 *
 *   pnpm test:native:fuzz              # every target, 60 s each
 */

#include "forces.h"
#include "fuzz_input.h"
#include "particles.h"
#include "routing.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

using fuzz::ptr;

void require(bool ok, const char* what) {
    if (!ok) {
        std::fprintf(stderr, "forces_fuzz: %s\n", what);
        std::abort();
    }
}

/** A count JS might send: usually small and valid, sometimes zero, negative or past `cap`. */
int count(fuzz::Input& in, int cap, int typical) {
    switch (in.u32() % 8u) {
        case 0: return 0;
        case 1: return -in.pick(1, 1 << 20);
        case 2: return cap + in.pick(1, 1 << 20);
        default: return in.pick(1, typical);
    }
}

void fuzzForces(fuzz::Input& in) {
    const float args[] = {in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(),
                          in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(), in.raw(),
                          in.raw(), in.raw()};
    (void)calculateWaterForce(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8],
                              args[9], args[10], args[11], args[12], args[13], args[14], args[15], args[16],
                              args[17]);
    (void)computeFlowForce(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8],
                           args[9], args[10]);
    (void)computeBuoyancy(args[0], args[1], args[2]);
    (void)computeDragForce(args[0], args[1], args[2], args[3], args[4], args[5]);
    (void)calculateBuoyancyAndDrag(args[0], args[1], args[2], args[3]);

    const int n = count(in, WATER_FORCE_MAX_SAMPLES, 64);
    const bool valid = n > 0 && n <= WATER_FORCE_MAX_SAMPLES;
    std::vector<float> input(valid ? static_cast<size_t>(n) * WATER_FORCE_INPUT_STRIDE : 1);
    for (float& v : input) v = in.coin() ? in.raw() : in.range(-50.f, 50.f);
    std::vector<float> output(valid ? static_cast<size_t>(n) * WATER_FORCE_OUTPUT_STRIDE : 1, 7.f);
    computeWaterForcesBatch(in.coin() && valid ? 0 : ptr(input), ptr(output), n, args[0], args[1], args[2],
                            args[3], args[4], args[5], args[6], args[7], args[8], args[9]);
}

void fuzzRouting(fuzz::Input& in) {
    const int nSeg = count(in, ROUTING_MAX_SEGMENTS, 40);
    const bool valid = nSeg > 0 && nSeg <= ROUTING_MAX_SEGMENTS;
    const size_t n = valid ? static_cast<size_t>(nSeg) : 1;
    const bool physical = in.coin();
    const auto value = [&](float lo, float hi) { return physical ? in.range(lo, hi) : in.raw(); };
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
    (void)routedEdgeState(in.raw(), in.raw(), in.raw(), in.raw());
    if (valid && physical) {
        for (float v : storage) require(std::isfinite(v) && v >= 0.f, "routing storage left [0, inf)");
        // Outflow is only finite, not >= 0: it is the volume balance
        // inflow * dt + (S - next), and S - next cancels in f32 when a long,
        // wide, flat reach holds ~1e6 m^3 — rounding of the storage, not a
        // conservation bug, and the routing numerics are not this fuzzer's.
        for (float v : outflow) require(std::isfinite(v), "routing outflow is non-finite");
    }
}

void fuzzParticles(fuzz::Input& in) {
    const int capacity = count(in, PARTICLE_MAX_CAPACITY, 300);
    const bool valid = capacity > 0 && capacity <= PARTICLE_MAX_CAPACITY;
    const uintptr_t base = allocateParticleSoA(capacity);
    require(valid == (base != 0), "allocateParticleSoA accepted an invalid capacity or failed a valid one");
    if (!valid) {
        std::vector<float> guard(PARTICLE_SOA_PLANES, 7.f);
        (void)stepWaterfallParticles(ptr(guard), capacity, 1, 0.016f, 1.f, 1.f, 1.f, 1u);
        stepSplashParticles(ptr(guard), capacity, 1, 0.016f, -9.8f, 0.99f);
        require(std::all_of(guard.begin(), guard.end(), [](float v) { return v == 7.f; }),
                "a rejected particle call wrote memory");
        return;
    }
    // Active / count may exceed capacity or be negative: the kernels clamp.
    const int active = in.pick(-10, capacity + 10);
    uint32_t seed = initWaterfallParticles(base, capacity, active, in.range(0.f, 20.f), in.range(0.f, 40.f),
                                           in.range(0.f, 5.f), in.range(0.f, 3.f), in.u32());
    const int steps = in.pick(1, 6);
    for (int s = 0; s < steps; ++s) {
        seed = stepWaterfallParticles(base, capacity, active, in.range(-0.1f, 0.1f), in.range(0.f, 20.f),
                                      in.range(0.f, 40.f), in.range(0.f, 5.f), seed);
        stepSplashParticles(base, capacity, in.pick(-10, capacity + 10), in.range(-0.1f, 0.1f),
                            in.range(-20.f, 0.f), in.range(0.f, 1.f));
    }
    freeParticleSoA(base);
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    fuzz::Input in{data, size};
    switch (in.u32() % 3u) {
        case 0: fuzzForces(in); break;
        case 1: fuzzRouting(in); break;
        default: fuzzParticles(in); break;
    }
    return 0;
}
