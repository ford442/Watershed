/**
 * host_smoke.cpp — Catch2-free host assert runner for watershed_compute.
 *
 * Covers buoyancy, one calculateWaterForce fixture (same numbers as
 * waterForceParity.test.ts), and one SWE step (CFL clamp + damping + 32×24
 * bump golden). No Embind.
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

    // 3. SWE — 32×24 medium budget, dt above CFL so clamp fires.
    constexpr int kWidth = 32;
    constexpr int kHeight = 24;
    constexpr float kDx = 0.75f;
    constexpr float kG = 9.80665f;
    constexpr float kH = 1.f;
    constexpr float kDt = 1.f;  // well above CFL
    const int n = kWidth * kHeight;

    const float waveSpeed = std::sqrt(kG * kH);
    const float cflMax = kDx / (waveSpeed * 1.5f);
    check(kDt > cflMax, "fixture dt exceeds CFL so clamp is exercised");
    const float safeDt = cflMax;
    const float expectedDamp = 1.f - safeDt * DAMPING_COEFF;

    // 3a. Uniform u=w=1, flat h: no gradients → only damping + CFL clamp.
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 1.f);
        std::vector<float> w(static_cast<std::size_t>(n), 1.f);
        stepShallowWater(
            reinterpret_cast<uintptr_t>(h.data()),
            reinterpret_cast<uintptr_t>(u.data()),
            reinterpret_cast<uintptr_t>(w.data()),
            kWidth, kHeight, kDt, kG, kDx, kH);
        checkClose(u[0], expectedDamp, 1e-4f, "CFL damping u[0]");
        checkClose(w[n / 2], expectedDamp, 1e-4f, "CFL damping w[mid]");
        check(std::abs(u[0]) > 0.5f, "CFL clamp must not use unclamped dt (would zero velocities)");
    }

    // 3b. Single-cell bump golden (center 16,12 = 0.4).
    {
        std::vector<float> h(static_cast<std::size_t>(n), 0.f);
        std::vector<float> u(static_cast<std::size_t>(n), 0.f);
        std::vector<float> w(static_cast<std::size_t>(n), 0.f);
        h[12 * kWidth + 16] = 0.4f;
        stepShallowWater(
            reinterpret_cast<uintptr_t>(h.data()),
            reinterpret_cast<uintptr_t>(u.data()),
            reinterpret_cast<uintptr_t>(w.data()),
            kWidth, kHeight, kDt, kG, kDx, kH);

        auto at = [&](int x, int z) { return z * kWidth + x; };
        checkClose(h[at(16, 12)], -0.31111111f, 1e-4f, "bump center h");
        checkClose(u[at(16, 12)],  0.82174857f, 1e-4f, "bump center u");
        checkClose(w[at(16, 12)],  0.82174857f, 1e-4f, "bump center w");
        checkClose(h[at(15, 12)],  0.17777778f, 1e-4f, "bump left h");
        checkClose(u[at(15, 12)], -0.82174857f, 1e-4f, "bump left u");
        checkClose(h[at(17, 12)],  0.17777778f, 1e-4f, "bump right h");
        checkClose(h[at(16, 11)],  0.17777778f, 1e-4f, "bump up h");
        checkClose(w[at(16, 11)], -0.82174857f, 1e-4f, "bump up w");
        checkClose(h[at(16, 13)],  0.17777778f, 1e-4f, "bump down h");
    }

    if (g_failures != 0) {
        std::fprintf(stderr, "watershed_host_smoke: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("watershed_host_smoke ok\n");
    return 0;
}
