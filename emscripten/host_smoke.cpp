/**
 * host_smoke.cpp — Catch2-free host assert runner for watershed_compute.
 *
 * Covers buoyancy, one calculateWaterForce fixture (same numbers as
 * waterForceParity.test.ts), and the nonlinear SWE contract: CFL clamp,
 * uniform-flow preservation, lake-at-rest well-balancing over a bed bump,
 * wetting/drying, a 1D dam-break slice, and a sampled U-channel bed of the
 * shape src/systems/water/bathymetrySampler.ts rasterizes (#374 Phase 2).
 * No Embind.
 *
 *   cmake -S emscripten -B emscripten/build-host
 *   cmake --build emscripten/build-host
 *   ./emscripten/build-host/watershed_host_smoke
 */

#include "forces.h"
#include "swe.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <vector>

namespace {

int g_failures = 0;

void check(bool ok, const char* label) {
    if (!ok) {
        std::fprintf(stderr, "FAIL  %s\n", label);
        ++g_failures;
    }
}

void checkClose(float actual, float expected, float relEps, const char* label) {
    const float tol = std::max(std::abs(expected) * relEps, 1e-4f);
    if (std::abs(actual - expected) > tol) {
        std::fprintf(stderr, "FAIL  %s: expected %g, got %g (tol %g)\n",
                     label, expected, actual, tol);
        ++g_failures;
    }
}

}  // namespace

int main() {
    // 1. Archimedes buoyancy
    const float buoyancy = computeBuoyancy(1.f, 1000.f, 9.80665f);
    checkClose(buoyancy, 9806.65f, 1e-5f, "computeBuoyancy(1, 1000, 9.80665)");

    // 2. calculateWaterForce — first committed fixture
    //    "raft fully submerged, straight downstream flow"
    const WaterForceResult force = calculateWaterForce(
        0.f, 0.2f, -10.f,
        0.2f, 0.f, -1.4f,
        0.f, -1.f,
        4.5f,
        0.5f,
        150.f,
        1.2f,
        0.47f,
        1.05f,
        0.7f,
        12.5f,
        0.f,
        2.4f);
    checkClose(force.forceX, -239.3792f, 1e-3f, "fixture0.forceX");
    checkClose(force.forceY, 11253.1309f, 1e-3f, "fixture0.forceY");
    checkClose(force.forceZ, -1773.6646f, 1e-3f, "fixture0.forceZ");
    checkClose(force.buoyancy, 11767.98f, 1e-3f, "fixture0.buoyancy");
    checkClose(force.submergedRatio, 1.f, 1e-3f, "fixture0.submergedRatio");

    // ------------------------------------------------------------------
    // 3. Nonlinear SWE contract
    //
    //    Field convention (ABI 6): h is the free-surface PERTURBATION eta,
    //    b is bed elevation above the floor datum, total depth = H + eta - b.
    // ------------------------------------------------------------------
    constexpr int kWidth = 32;
    constexpr int kHeight = 24;
    constexpr float kDx = 0.75f;
    constexpr float kG = 9.80665f;
    constexpr float kH = 1.f;
    constexpr float kDt = 1.f;  // well above CFL
    const int n = kWidth * kHeight;

    auto stepFlat = [&](std::vector<float>& h, std::vector<float>& u,
                        std::vector<float>& w, float dt) {
        stepShallowWater(
            reinterpret_cast<uintptr_t>(h.data()),
            reinterpret_cast<uintptr_t>(u.data()),
            reinterpret_cast<uintptr_t>(w.data()),
            0,  // flat bed
            kWidth, kHeight, dt, kG, kDx, kH);
    };
    auto stepBed = [&](std::vector<float>& h, std::vector<float>& u,
                       std::vector<float>& w, std::vector<float>& b, float dt) {
        stepShallowWater(
            reinterpret_cast<uintptr_t>(h.data()),
            reinterpret_cast<uintptr_t>(u.data()),
            reinterpret_cast<uintptr_t>(w.data()),
            reinterpret_cast<uintptr_t>(b.data()),
            kWidth, kHeight, dt, kG, kDx, kH);
    };

    // 3a. Uniform flow over a flat bed: fluxes are identical at every face, so
    //     the only surviving effect is CFL clamping + damping.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 1.f);
        std::vector<float> w(static_cast<std::size_t>(n), 1.f);

        // Mirror the solver's CFL rule so the fixture stays honest if it changes.
        const float maxWaveSpeed = std::sqrt(2.f) + std::sqrt(kG * kH);
        const float safeDt = 0.4f * kDx / maxWaveSpeed;
        check(kDt > safeDt, "fixture dt exceeds CFL so the clamp is exercised");
        const float expectedDamp = 1.f - safeDt * DAMPING_COEFF;

        stepFlat(h, u, w, kDt);

        checkClose(u[n / 2], expectedDamp, 1e-4f, "uniform flow: u damped only");
        checkClose(w[n / 2], expectedDamp, 1e-4f, "uniform flow: w damped only");
        checkClose(h[n / 2], 0.f, 1e-4f, "uniform flow: surface stays flat");
        check(std::abs(u[n / 2]) > 0.5f,
              "CFL clamp must not use unclamped dt (would zero velocities)");
    }

    // 3b. Lake at rest over a bed bump — the well-balanced property.
    //     A flat free surface over varying bathymetry must generate no current.
    //     The pre-ABI-6 linearised stepper could not express this at all: it had
    //     no bed term, so every bump was invisible to it.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 0.f);
        std::vector<float> w(static_cast<std::size_t>(n), 0.f);
        std::vector<float> b(static_cast<std::size_t>(n), 0.f);

        // Smooth bed bump rising to 60% of the still-water depth, plus a
        // channel-shaped bank profile so both axes are exercised.
        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < kWidth; ++x) {
                const float fx = static_cast<float>(x - kWidth / 2) / 6.f;
                const float fz = static_cast<float>(z - kHeight / 2) / 5.f;
                b[static_cast<std::size_t>(z * kWidth + x)] =
                    0.6f * kH * std::exp(-(fx * fx + fz * fz));
            }
        }

        float maxVel = 0.f;
        float maxSurfaceDrift = 0.f;
        for (int step = 0; step < 50; ++step) {
            stepBed(h, u, w, b, 0.01f);
            for (int i = 0; i < n; ++i) {
                // Only wet cells carry a meaningful surface; dry ones are pinned
                // to the bed by construction.
                if (kH + h[i] - b[i] <= 1e-4f) continue;
                maxVel = std::max(maxVel, std::max(std::abs(u[i]), std::abs(w[i])));
                maxSurfaceDrift = std::max(maxSurfaceDrift, std::abs(h[i]));
            }
        }

        // Documented epsilon: well-balancing holds to float round-off, not to
        // an eyeballed tolerance. 1e-5 m/s over 50 steps is ~4 orders of
        // magnitude below the ~0.1 m/s a real disturbance produces.
        check(maxVel < 1e-5f, "lake at rest over a bump generates no current");
        check(maxSurfaceDrift < 1e-5f, "lake at rest over a bump keeps a flat surface");
    }

    // 3c. Wetting/drying — a bank above the free surface stays dry, and stays
    //     dry after a disturbance passes next to it.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 0.f);
        std::vector<float> w(static_cast<std::size_t>(n), 0.f);
        std::vector<float> b(static_cast<std::size_t>(n), 0.f);

        // Left three columns are a bank standing well above the water line.
        const float bankHeight = kH * 1.5f;
        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < 3; ++x) {
                b[static_cast<std::size_t>(z * kWidth + x)] = bankHeight;
            }
        }
        // Disturbance in mid-channel that will run at the bank.
        h[static_cast<std::size_t>((kHeight / 2) * kWidth + 10)] = 0.5f;

        for (int step = 0; step < 40; ++step) {
            stepBed(h, u, w, b, 0.01f);
        }

        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < 3; ++x) {
                const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                const float depth = kH + h[i] - b[i];
                check(depth <= 1e-4f, "bank cell stays dry");
                check(u[i] == 0.f && w[i] == 0.f, "dry bank carries no velocity");
            }
        }
    }

    // 3d. 1D dam break: deep left, shallow right, flat bed. The front must move
    //     downstream and interior mass must be conserved while the wave is away
    //     from the transmissive boundaries.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 0.f);
        std::vector<float> w(static_cast<std::size_t>(n), 0.f);

        const int dam = kWidth / 2;
        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < dam; ++x) {
                h[static_cast<std::size_t>(z * kWidth + x)] = 0.5f;  // depth 1.5
            }
        }

        auto totalDepth = [&]() {
            double sum = 0.0;
            for (int i = 0; i < n; ++i) sum += static_cast<double>(kH + h[i]);
            return sum;
        };
        const double massBefore = totalDepth();

        // Few enough steps that the front stays well inside the domain.
        for (int step = 0; step < 12; ++step) {
            stepFlat(h, u, w, 0.004f);
        }
        const double massAfter = totalDepth();

        const int probeRow = kHeight / 2;
        auto at = [&](int x) { return static_cast<std::size_t>(probeRow * kWidth + x); };

        check(std::abs(massAfter - massBefore) / massBefore < 1e-5,
              "dam break conserves interior mass");
        check(h[at(dam)] > 1e-3f, "dam break wets the cell just downstream");
        check(h[at(dam - 1)] < 0.5f, "dam break draws down the reservoir side");
        check(u[at(dam)] > 0.f, "dam break drives flow downstream (+x)");
        check(std::abs(h[at(0)]) < 1e-3f || h[at(0)] > 0.4f,
              "far upstream is still undisturbed this early");
        check(std::abs(w[at(dam)]) < 1e-6f,
              "1D dam break generates no transverse velocity");
    }

    // 3e. Sampled canyon U-channel (#374 Phase 2). The TS bathymetry sampler
    //      writes exactly this shape into `b`: a wet thalweg a couple of cells
    //      wide flanked by banks standing well above the free surface. The bed
    //      must hold the water in the channel and stay well-balanced there.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 0.f);
        std::vector<float> w(static_cast<std::size_t>(n), 0.f);
        std::vector<float> b(static_cast<std::size_t>(n), 0.f);

        // Channel runs along +z (downstream), centred on the middle column.
        const int centre = kWidth / 2;
        const int halfChannel = 4;
        const float bankBed = kH + 2.f;  // BATHYMETRY_DRY_BED
        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < kWidth; ++x) {
                const int offset = std::abs(x - centre);
                const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                if (offset > halfChannel) {
                    b[i] = bankBed;
                } else {
                    // Gently shoaling U-profile: flat thalweg, rising to the bank.
                    const float r = static_cast<float>(offset) / static_cast<float>(halfChannel);
                    b[i] = 0.9f * kH * r * r;
                }
            }
        }

        auto isChannel = [&](int x) { return std::abs(x - centre) <= halfChannel; };

        float maxVel = 0.f;
        float maxSurfaceDrift = 0.f;
        for (int step = 0; step < 60; ++step) {
            stepBed(h, u, w, b, 0.01f);
            for (int z = 0; z < kHeight; ++z) {
                for (int x = 0; x < kWidth; ++x) {
                    const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                    if (kH + h[i] - b[i] <= 1e-4f) continue;
                    maxVel = std::max(maxVel, std::max(std::abs(u[i]), std::abs(w[i])));
                    maxSurfaceDrift = std::max(maxSurfaceDrift, std::abs(h[i]));
                }
            }
        }

        // Same documented epsilon as 3b: a sampled canyon must not invent a
        // current out of its own bathymetry.
        check(maxVel < 1e-5f, "sampled U-channel at rest generates no current");
        check(maxSurfaceDrift < 1e-5f, "sampled U-channel at rest keeps a flat surface");

        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < kWidth; ++x) {
                const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                const float depth = kH + h[i] - b[i];
                if (isChannel(x)) {
                    check(depth > 1e-3f, "U-channel thalweg stays wet");
                } else {
                    check(depth <= 1e-4f, "U-channel bank stays dry");
                }
            }
        }

        // A splash in the thalweg must not climb out onto the banks.
        h[static_cast<std::size_t>((kHeight / 2) * kWidth + centre)] = 0.4f;
        for (int step = 0; step < 40; ++step) {
            stepBed(h, u, w, b, 0.005f);
        }
        for (int z = 0; z < kHeight; ++z) {
            for (int x = 0; x < kWidth; ++x) {
                if (isChannel(x)) continue;
                const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                check(kH + h[i] - b[i] <= 1e-4f, "U-channel bank stays dry after a splash");
            }
        }
    }

    if (g_failures != 0) {
        std::fprintf(stderr, "watershed_host_smoke: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("watershed_host_smoke ok\n");
    return 0;
}
