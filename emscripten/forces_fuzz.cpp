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
#include <bit>
#include <cstdint>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <iterator>
#include <span>
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

/**
 * Finite or refused (ABI 18, #575) — the oracle the SWE / routing / chores
 * targets already had: whatever the inputs, a WS_OK or WS_PARTIAL batch has a
 * finite output, every refused row is zeros and flagged, every flagged row
 * had a non-finite input or would have had a non-finite result, and every
 * other row is bit-identical to calculateWaterForce. A rejected call writes
 * nothing.
 */
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
    const size_t rows = valid ? static_cast<size_t>(n) : 1;
    std::vector<float> input(rows * WATER_FORCE_INPUT_STRIDE);
    // Raw bit patterns (NaN, ±inf, huge) one float in two, else a physical value.
    for (float& v : input) v = in.coin() ? in.raw() : in.range(-50.f, 50.f);
    std::vector<float> output(rows * WATER_FORCE_OUTPUT_STRIDE, 7.f);
    std::vector<float> refused(rows, 7.f);
    // The config is physical three times in four, otherwise raw.
    float config[10];
    const float physical[10] = {4.5f, 0.5f, 150.f, 1.2f, 0.47f, 1.05f, 0.7f, 12.5f, 0.12f, 2.4f};
    for (size_t k = 0; k < 10; ++k) config[k] = in.u32() % 4u == 0 ? in.raw() : physical[k];
    const bool nullInput = in.coin() && valid;
    const bool flags = in.coin();
    const int status = computeWaterForcesBatch(nullInput ? 0 : ptr(input), ptr(output), flags ? ptr(refused) : 0, n,
                                               config[0], config[1], config[2], config[3], config[4], config[5],
                                               config[6], config[7], config[8], config[9]);
    const bool configFinite = std::all_of(std::begin(config), std::end(config), [](float v) { return std::isfinite(v); });
    if (!valid || nullInput || !configFinite) {
        require(status == WS_REJECTED, "computeWaterForcesBatch accepted a bad count, a null input or a non-finite config");
        require(std::all_of(output.begin(), output.end(), [](float v) { return v == 7.f; })
                    && std::all_of(refused.begin(), refused.end(), [](float v) { return v == 7.f; }),
                "a rejected force batch wrote memory");
        return;
    }
    require(status == WS_OK || status == WS_PARTIAL, "computeWaterForcesBatch returned an unknown status");
    require(std::all_of(output.begin(), output.end(), [](float v) { return std::isfinite(v); }),
            "computeWaterForcesBatch returned a non-finite force");
    bool anyRefused = false;
    for (size_t r = 0; r < rows; ++r) {
        const std::span<const float> s = std::span<const float>(input).subspan(r * WATER_FORCE_INPUT_STRIDE, WATER_FORCE_INPUT_STRIDE);
        const std::span<const float> o = std::span<const float>(output).subspan(r * WATER_FORCE_OUTPUT_STRIDE, WATER_FORCE_OUTPUT_STRIDE);
        const WaterForceResult want = calculateWaterForce(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], config[0],
                                                          config[1], config[2], config[3], config[4], config[5],
                                                          config[6], config[7], config[8], config[9]);
        const float w[8] = {want.forceX, want.forceY, want.forceZ, want.buoyancy,
                            want.drag, want.flow, want.turbulence, want.submergedRatio};
        const bool rowOk = std::all_of(s.begin(), s.end(), [](float v) { return std::isfinite(v); })
                           && std::all_of(std::begin(w), std::end(w), [](float v) { return std::isfinite(v); });
        if (flags) require(refused[r] == (rowOk ? 0.f : 1.f), "the refused plane disagrees with the row");
        if (rowOk) {
            // Bit-identical: the same function on the same inputs (compared as bits, so -0 / +0 differ).
            require(std::equal(o.begin(), o.end(), std::begin(w),
                               [](float a, float b) { return std::bit_cast<uint32_t>(a) == std::bit_cast<uint32_t>(b); }),
                    "an accepted row differs from calculateWaterForce");
        } else {
            anyRefused = true;
            require(std::all_of(o.begin(), o.end(), [](float v) { return v == 0.f; }), "a refused row is not zeros");
        }
    }
    require((status == WS_PARTIAL) == anyRefused, "WS_PARTIAL iff some row was refused");
}

void fuzzParticles(fuzz::Input& in) {
    const int capacity = count(in, PARTICLE_MAX_CAPACITY, 300);
    const bool valid = capacity > 0 && capacity <= PARTICLE_MAX_CAPACITY;
    const uintptr_t base = allocateParticleSoA(capacity);
    require(valid == (base != 0), "allocateParticleSoA accepted an invalid capacity or failed a valid one");
    if (!valid) {
        std::vector<float> guard(PARTICLE_SOA_PLANES, 7.f);
        uint32_t seed = 1u;
        require(stepWaterfallParticles(ptr(guard), capacity, 1, 0.016f, 1.f, 1.f, 1.f, seed, fuzz::ptr(seed)) == WS_REJECTED
                    && seed == 1u,
                "stepWaterfallParticles accepted an invalid capacity");
        require(stepSplashParticles(ptr(guard), capacity, 1, 0.016f, -9.8f, 0.99f) == WS_REJECTED,
                "stepSplashParticles accepted an invalid capacity");
        require(std::all_of(guard.begin(), guard.end(), [](float v) { return v == 7.f; }),
                "a rejected particle call wrote memory");
        return;
    }
    // Active / count may exceed capacity or be negative: the kernels clamp.
    const int active = in.pick(-10, capacity + 10);
    uint32_t seed = in.u32();
    const uint32_t seed0 = seed;
    const float w0 = in.scalar(0.f, 20.f);
    const float h0 = in.scalar(0.f, 40.f);
    const float d0 = in.scalar(0.f, 5.f);
    const float f0 = in.scalar(0.f, 3.f);
    const int st = initWaterfallParticles(base, capacity, active, w0, h0, d0, f0, seed, fuzz::ptr(seed));
    const bool finiteInit = std::isfinite(w0) && std::isfinite(h0) && std::isfinite(d0) && std::isfinite(f0);
    require(st == (finiteInit ? WS_OK : WS_REJECTED), "initWaterfallParticles status disagrees with its scalars");
    require(finiteInit || seed == seed0, "a rejected initWaterfallParticles wrote the seed");
    const int steps = in.pick(1, 6);
    for (int s = 0; s < steps; ++s) {
        const uint32_t before = seed;
        if (stepWaterfallParticles(base, capacity, active, in.scalar(-0.1f, 0.1f), in.scalar(0.f, 20.f),
                                   in.scalar(0.f, 40.f), in.scalar(0.f, 5.f), seed, fuzz::ptr(seed)) != WS_OK) {
            require(seed == before, "a rejected stepWaterfallParticles wrote the seed");
        }
        (void)stepSplashParticles(base, capacity, in.pick(-10, capacity + 10), in.scalar(-0.1f, 0.1f),
                                  in.scalar(-20.f, 0.f), in.scalar(0.f, 1.f));
    }
    // A NaN / inf scalar is rejected, never integrated into the SoA.
    const size_t floats = static_cast<size_t>(capacity) * PARTICLE_SOA_PLANES;
    const std::span<const float> soa(reinterpret_cast<const float*>(base), floats);
    require(std::all_of(soa.begin(), soa.end(), [](float v) { return std::isfinite(v); }),
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
