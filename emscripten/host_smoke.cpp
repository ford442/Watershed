/**
 * host_smoke.cpp — Catch2-free host assert runner for watershed_compute.
 *
 * Covers buoyancy, one calculateWaterForce fixture (same numbers as
 * waterForceParity.test.ts), and the nonlinear SWE goldens from swe_goldens.h
 * (well-balanced lake at rest, wetting/drying, dam break, CFL substepping).
 * No Embind.
 *
 *   cmake -S emscripten -B emscripten/build-host
 *   cmake --build emscripten/build-host
 *   ./emscripten/build-host/watershed_host_smoke
 */

#include "forces.h"
#include "swe.h"
#include "swe_goldens.h"

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

    // 3. SWE — nonlinear conservative solver (#374 Phase 1 goldens).
    {
        using namespace swe_goldens;
        const GridSpec spec;
        const int n = spec.cells();

        // 3a. Lake at rest over a submerged bump: well-balanced, no current.
        {
            Fields f = lakeAtRest(spec);
            std::vector<float> surface0(static_cast<std::size_t>(n));
            for (int i = 0; i < n; ++i) surface0[i] = f.h[i] + f.b[i];

            for (int s = 0; s < 20; ++s) step(spec, f, 1.f / 60.f);

            float maxVel = 0.f;
            float maxSurfaceDrift = 0.f;
            for (int i = 0; i < n; ++i) {
                maxVel = std::max(maxVel, std::max(std::abs(f.u[i]), std::abs(f.w[i])));
                maxSurfaceDrift = std::max(maxSurfaceDrift,
                                           std::abs((f.h[i] + f.b[i]) - surface0[i]));
            }
            check(maxVel <= kLakeAtRestVelocityEps, "lake at rest generates no current");
            check(maxSurfaceDrift <= kLakeAtRestSurfaceEps, "lake at rest surface stays flat");
            if (maxVel > kLakeAtRestVelocityEps || maxSurfaceDrift > kLakeAtRestSurfaceEps) {
                std::fprintf(stderr, "      maxVel=%g maxSurfaceDrift=%g\n",
                             maxVel, maxSurfaceDrift);
            }
        }

        // 3b. Wetting/drying: cells whose bed breaks the surface stay dry.
        {
            Fields f = dryBasin(spec);
            for (int s = 0; s < 30; ++s) step(spec, f, 1.f / 60.f);

            bool dryHeld = true;
            bool positive = true;
            for (int z = 0; z < spec.height; ++z) {
                for (int x = 0; x < spec.width; ++x) {
                    const int i = z * spec.width + x;
                    if (f.h[i] < 0.f) positive = false;
                    if (!dryBasinCellIsDry(spec, x, z)) continue;
                    if (f.h[i] > SWE_DRY_DEPTH) dryHeld = false;
                    if (f.u[i] != 0.f || f.w[i] != 0.f) dryHeld = false;
                }
            }
            check(dryHeld, "dry crest cells stay dry with zero velocity");
            check(positive, "no negative depths after wetting/drying");
        }

        // 3c. Dam break: positive depths, conserved mass, sub-analytic front.
        {
            Fields f = damBreak(spec);
            const float mass0 = totalMass(f.h);
            const float frontSpeedMax = std::sqrt(spec.g * 1.5f) * 2.f;

            const float dt = 1.f / 60.f;
            const int steps = 12;
            for (int s = 0; s < steps; ++s) step(spec, f, dt);

            const float mass1 = totalMass(f.h);
            checkClose(mass1, mass0, kMassRelEps, "dam break conserves mass");

            bool positive = true;
            bool finite = true;
            for (int i = 0; i < n; ++i) {
                if (f.h[i] < 0.f) positive = false;
                if (!std::isfinite(f.h[i]) || !std::isfinite(f.u[i]) || !std::isfinite(f.w[i])) {
                    finite = false;
                }
            }
            check(positive, "dam break keeps depths non-negative");
            check(finite, "dam break stays finite");

            // The disturbance must not outrun the analytic wet-bed front.
            const int mid = spec.width / 2;
            const int reach = static_cast<int>(
                std::ceil(frontSpeedMax * dt * static_cast<float>(steps) / spec.dx)) + 1;
            const int probe = std::min(spec.width - 1, mid + reach + 2);
            const int row = spec.height / 2;
            checkClose(f.h[row * spec.width + probe], 0.3f, 1e-2f,
                       "dam break front has not reached the far probe");

            // Downstream of the dam the surge must have raised the water.
            check(f.h[row * spec.width + mid + 1] > 0.3f,
                  "dam break surge moves downstream");
        }

        // 3d. CFL substepping: a frame delta far above the stable step must be
        //     absorbed inside C++ without blowing up.
        {
            Fields f = damBreak(spec);
            step(spec, f, 1.f);
            bool finite = true;
            for (int i = 0; i < n; ++i) {
                if (!std::isfinite(f.h[i]) || f.h[i] < 0.f) finite = false;
            }
            check(finite, "oversized dt is CFL-substepped, not exploded");
        }
    }

    if (g_failures != 0) {
        std::fprintf(stderr, "watershed_host_smoke: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("watershed_host_smoke ok\n");
    return 0;
}
