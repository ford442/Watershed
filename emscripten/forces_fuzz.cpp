/**
 * forces_fuzz.cpp — libFuzzer target over the per-body entry
 * points (#502, host only): water forces (single + batch) and the particle
 * SoA. Channel routing has its own target, routing_fuzz.cpp.
 *
 * Buffers are allocated at exactly the size each call names; counts are
 * sometimes non-positive or past the documented caps (WATER_FORCE_MAX_SAMPLES,
 * PARTICLE_MAX_CAPACITY), which must be a no-op. Force inputs are any float
 * bit pattern. Under ASan + UBSan an out-of-bounds access or an int overflow
 * is a crash. Particle scalars are a NaN, ±inf, denormal or ±0 one draw in
 * four, and the SoA must stay finite.
 *
 *   pnpm test:native:fuzz              # every target, 60 s each
 */

#include "forces.h"
#include "fuzz_input.h"
#include "particles.h"

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
    (void)computeBuoyancy(args[0], args[1], args[2]);

    const int n = count(in, WATER_FORCE_MAX_SAMPLES, 64);
    const bool valid = n > 0 && n <= WATER_FORCE_MAX_SAMPLES;
    std::vector<float> input(valid ? static_cast<size_t>(n) * WATER_FORCE_INPUT_STRIDE : 1);
    for (float& v : input) v = in.coin() ? in.raw() : in.range(-50.f, 50.f);
    std::vector<float> output(valid ? static_cast<size_t>(n) * WATER_FORCE_OUTPUT_STRIDE : 1, 7.f);
    computeWaterForcesBatch(in.coin() && valid ? 0 : ptr(input), ptr(output), n, args[0], args[1], args[2],
                            args[3], args[4], args[5], args[6], args[7], args[8], args[9]);
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
    uint32_t seed = initWaterfallParticles(base, capacity, active, in.scalar(0.f, 20.f), in.scalar(0.f, 40.f),
                                           in.scalar(0.f, 5.f), in.scalar(0.f, 3.f), in.u32());
    const int steps = in.pick(1, 6);
    for (int s = 0; s < steps; ++s) {
        seed = stepWaterfallParticles(base, capacity, active, in.scalar(-0.1f, 0.1f), in.scalar(0.f, 20.f),
                                      in.scalar(0.f, 40.f), in.scalar(0.f, 5.f), seed);
        stepSplashParticles(base, capacity, in.pick(-10, capacity + 10), in.scalar(-0.1f, 0.1f),
                            in.scalar(-20.f, 0.f), in.scalar(0.f, 1.f));
    }
    // A NaN / inf scalar is rejected, never integrated into the SoA.
    const float* soa = reinterpret_cast<const float*>(base);
    const size_t floats = static_cast<size_t>(capacity) * PARTICLE_SOA_PLANES;
    require(std::all_of(soa, soa + floats, [](float v) { return std::isfinite(v); }),
            "a particle scalar left a non-finite value in the SoA");
    freeParticleSoA(base);
}

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    fuzz::Input in{data, size};
    if (in.coin()) {
        fuzzForces(in);
    } else {
        fuzzParticles(in);
    }
    return 0;
}
