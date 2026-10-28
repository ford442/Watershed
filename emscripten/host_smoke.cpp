/**
 * host_smoke.cpp — Catch2-free host assert runner for watershed_compute.
 *
 * Covers buoyancy, one calculateWaterForce fixture (same numbers as
 * waterForceParity.test.ts), and the nonlinear SWE contract: CFL clamp,
 * uniform-flow preservation, lake-at-rest well-balancing over a bed bump,
 * wetting/drying, a 1D dam-break slice, and a sampled U-channel bed of the
 * shape src/systems/water/bathymetrySampler.ts rasterizes (#374 Phase 2).
 * Also channel routing (routing.cpp): a step release reaches a downstream
 * segment only after the routed lag, volume is conserved, and the routed
 * upstream edge (stepShallowWaterInflow) keeps lake-at-rest at the reference
 * discharge. And the terrain tile (terrain.cpp, #487): the three golden
 * segments' plane sums, the tube overhang, and the input guards.
 * Host only (no Emscripten headers).
 *
 *   cmake -S emscripten -B emscripten/build-host
 *   cmake --build emscripten/build-host
 *   ./emscripten/build-host/watershed_host_smoke
 */

#include "chores.h"
#include "forces.h"
#include "native_digest.h"
#include "swe.h"
#include "particles.h"
#include "routing.h"
#include "terrain.h"
#include "terrain_goldens.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <span>
#include <cstdint>
#include <algorithm>
#include <limits>
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

    // 4. Waterfall SoA — 128 particles, 60 steps, finite, chute AABB
    {
        constexpr int kCap = 128;
        constexpr int kN = 128;
        constexpr float kW = 15.f;
        constexpr float kHgt = 25.f;
        constexpr float kD = 5.f;
        const uintptr_t base = allocateParticleSoA(kCap);
        check(base != 0, "allocateParticleSoA");
        uint32_t seed = initWaterfallParticles(base, kCap, kN, kW, kHgt, kD, 0.f, 0xC0FFEEu);
        for (int step = 0; step < 60; ++step) {
            seed = stepWaterfallParticles(base, kCap, kN, 1.f / 60.f, kW, kHgt, kD, seed);
        }
        const float* px = reinterpret_cast<const float*>(base);
        const float* py = px + kCap;
        const float* pz = px + 2 * kCap;
        bool finite = true;
        bool inChute = true;
        for (int i = 0; i < kN; ++i) {
            if (!std::isfinite(px[i]) || !std::isfinite(py[i]) || !std::isfinite(pz[i])) {
                finite = false;
            }
            if (px[i] < -kW * 0.5f - 1e-3f || px[i] > kW * 0.5f + 1e-3f) inChute = false;
            if (py[i] < -1e-3f || py[i] > kHgt + 1e-3f) inChute = false;
            if (pz[i] < -kD * 0.5f - 1e-3f || pz[i] > kD * 0.5f + 1e-3f) inChute = false;
        }
        check(finite, "waterfall particles stay finite");
        check(inChute, "waterfall particles stay in chute AABB");
        freeParticleSoA(base);
    }

    // 5. Inflow pulse vs control hour — eta rises only on the pulsed grid.
    {
        const int w = 8, h = 8, N = w * h;
        std::vector<float> hCtl(N, 0.f), uCtl(N, 0.f), wCtl(N, 0.f), bCtl(N, 0.f);
        std::vector<float> hPulse = hCtl, uPulse = uCtl, wPulse = wCtl, bPulse = bCtl;
        applySWEEvent(
            reinterpret_cast<uintptr_t>(hPulse.data()),
            reinterpret_cast<uintptr_t>(uPulse.data()),
            reinterpret_cast<uintptr_t>(wPulse.data()),
            reinterpret_cast<uintptr_t>(bPulse.data()),
            w, h, 1.f, 0.f, 0.f, 1.2f,
            0, 3.5f, 3.5f, 4.f, 8.f, 0.05f);
        float maxCtl = 0.f, maxPulse = 0.f;
        for (int i = 0; i < N; ++i) {
            maxCtl = std::max(maxCtl, std::abs(hCtl[i]));
            maxPulse = std::max(maxPulse, hPulse[i]);
        }
        float minW = 0.f;
        for (int i = 0; i < N; ++i) minW = std::min(minW, wPulse[i]);
        check(maxCtl < 1e-6f, "control hour eta stays at rest");
        check(maxPulse > 0.05f, "inflow pulse raises eta vs control");
        check(minW < -0.02f, "inflow pulse carries downstream momentum");
    }

    // 6. Braid — bed shoal is idempotent under repeated steps, and pushes
    //    water laterally away from the axis (#397).
    {
        const int w = 8, h = 8, N = w * h;
        std::vector<float> hB(N, 0.f), uB(N, 0.f), wB(N, 0.f), bB(N, 0.f);
        auto braid = [&]() {
            applySWEEvent(
                reinterpret_cast<uintptr_t>(hB.data()),
                reinterpret_cast<uintptr_t>(uB.data()),
                reinterpret_cast<uintptr_t>(wB.data()),
                reinterpret_cast<uintptr_t>(bB.data()),
                w, h, 1.f, 0.f, 0.f, 1.2f,
                2, 3.5f, 3.5f, 4.f, 1.5f, 0.05f);
        };
        braid();
        std::vector<float> bOnce = bB;
        for (int k = 0; k < 8; ++k) braid();
        float bedDrift = 0.f, maxBed = 0.f, leftPush = 0.f, rightPush = 0.f;
        for (int i = 0; i < N; ++i) {
            bedDrift = std::max(bedDrift, std::abs(bB[i] - bOnce[i]));
            maxBed = std::max(maxBed, bB[i]);
        }
        for (int j = 0; j < h; ++j) {
            for (int i = 0; i < w; ++i) {
                const float ddx = static_cast<float>(i) - 3.5f;
                const float val = uB[j * w + i];
                if (ddx > 0.f) rightPush = std::max(rightPush, val);
                if (ddx < 0.f) leftPush = std::min(leftPush, val);
            }
        }
        check(bedDrift < 1e-6f, "braid bed shoal is idempotent");
        check(maxBed > 0.5f, "braid raises the bed");
        check(rightPush > 0.f && leftPush < 0.f, "braid pushes water around the shoal");
    }

    // ------------------------------------------------------------------
    // 7. Window scroll (ABI 9). The SWE grid is a player-centred window that
    //    moves; scrollShallowWater moves h/u/w/b with the world so a splash
    //    stays put while the origin travels. Sign: shift = (oldOrigin -
    //    newOrigin) / dx, i.e. how far the content moves through the index
    //    frame, so a window travelling downstream (-Z) has a POSITIVE shiftZ.
    // ------------------------------------------------------------------
    {
        auto scroll = [](std::vector<float>& h, std::vector<float>& u, std::vector<float>& w,
                         std::vector<float>* b, int width, int height, int sx, int sz,
                         float eta = 0.f, float uIn = 0.f, float wIn = 0.f) {
            scrollShallowWater(
                reinterpret_cast<uintptr_t>(h.data()),
                reinterpret_cast<uintptr_t>(u.data()),
                reinterpret_cast<uintptr_t>(w.data()),
                b ? reinterpret_cast<uintptr_t>(b->data()) : 0,
                width, height, sx, sz, eta, uIn, wIn);
        };

        // 7a. Kernel semantics on a small grid with a distinct value per cell.
        {
            constexpr int W = 16;
            constexpr int Hh = 12;
            const std::size_t sn = static_cast<std::size_t>(W * Hh);
            auto at = [](int x, int z) { return static_cast<std::size_t>(z * W + x); };

            std::vector<float> h(sn), u(sn), w(sn), b(sn);
            for (std::size_t i = 0; i < sn; ++i) {
                h[i] = 1.f + 0.01f * static_cast<float>(i);
                u[i] = -2.f - 0.01f * static_cast<float>(i);
                w[i] = 3.f + 0.01f * static_cast<float>(i);
                b[i] = 0.5f + 0.001f * static_cast<float>(i);
            }
            const std::vector<float> h0 = h, u0 = u, w0 = w, b0 = b;

            scroll(h, u, w, &b, W, Hh, 3, -2, 0.05f, 0.1f, -0.2f);
            bool moved = true, filled = true, bedExt = true;
            for (int z = 0; z < Hh; ++z) {
                for (int x = 0; x < W; ++x) {
                    const int sx = x - 3;
                    const int sz = z + 2;
                    const std::size_t i = at(x, z);
                    if (sx >= 0 && sx < W && sz >= 0 && sz < Hh) {
                        const std::size_t s = at(sx, sz);
                        moved = moved && h[i] == h0[s] && u[i] == u0[s] && w[i] == w0[s];
                    } else {
                        filled = filled && h[i] == 0.05f && u[i] == 0.1f && w[i] == -0.2f;
                    }
                    bedExt = bedExt && b[i] == b0[at(std::min(std::max(sx, 0), W - 1),
                                                     std::min(std::max(sz, 0), Hh - 1))];
                }
            }
            check(moved, "scroll: surviving cells take dst[x,z] = src[x-shiftX, z-shiftZ] exactly");
            check(filled, "scroll: entering cells take the inflow state");
            check(bedExt, "scroll: entering bed cells extend the nearest edge");

            // Sign. Positive shift moves content to higher indices; +Z is
            // upstream, so a window travelling downstream scrolls +shiftZ.
            std::fill(h.begin(), h.end(), 0.f);
            std::fill(u.begin(), u.end(), 0.f);
            std::fill(w.begin(), w.end(), 0.f);
            h[at(5, 6)] = 0.3f;
            scroll(h, u, w, nullptr, W, Hh, 0, 2);
            check(h[at(5, 8)] == 0.3f && h[at(5, 6)] == 0.f, "scroll: +shiftZ moves content to higher rows");
            scroll(h, u, w, nullptr, W, Hh, 3, 0);
            check(h[at(8, 8)] == 0.3f && h[at(5, 8)] == 0.f, "scroll: +shiftX moves content to higher columns");
            scroll(h, u, w, nullptr, W, Hh, -3, -2);
            check(h[at(5, 6)] == 0.3f, "scroll: opposite shift returns the content to its cell");

            // Leaving the window drops the water. Nothing wraps to the far edge.
            auto energy = [&]() {
                double sum = 0.0;
                for (float v : h) sum += std::abs(static_cast<double>(v));
                return sum;
            };
            std::fill(h.begin(), h.end(), 0.f);
            h[at(14, 6)] = 0.3f;
            scroll(h, u, w, nullptr, W, Hh, 3, 0);
            check(energy() == 0.0, "scroll: a bump leaving the high-column edge is gone, not wrapped");
            h[at(5, 10)] = 0.3f;
            scroll(h, u, w, nullptr, W, Hh, 0, 3);
            check(energy() == 0.0, "scroll: a bump leaving the upstream (high-row) edge is gone, not wrapped");
            h[at(1, 6)] = 0.3f;
            scroll(h, u, w, nullptr, W, Hh, -3, 0);
            check(energy() == 0.0, "scroll: a bump leaving the low-column edge is gone, not wrapped");

            // Saturation: a teleport-sized delta replaces the whole field and
            // never overflows the index arithmetic.
            for (int shift : {W, W + 5, std::numeric_limits<int>::max(), std::numeric_limits<int>::min()}) {
                std::fill(h.begin(), h.end(), 0.7f);
                b = b0;
                scroll(h, u, w, &b, W, Hh, shift, 0, 0.f);
                bool allRest = true;
                for (float v : h) allRest = allRest && v == 0.f;
                check(allRest, "scroll: |shift| >= extent replaces every cell");
                for (std::size_t i = 0; i < sn; ++i) {
                    if (!(std::abs(b[i] - b0[shift > 0 ? at(0, static_cast<int>(i) / W) : at(W - 1, static_cast<int>(i) / W)]) == 0.f)) {
                        check(false, "scroll: saturated bed extends the edge it left through");
                        break;
                    }
                }
            }

            // Zero shift is a bitwise no-op; a null bed leaves the bed alone.
            h = h0; u = u0; w = w0; b = b0;
            scroll(h, u, w, &b, W, Hh, 0, 0, 9.f, 9.f, 9.f);
            check(h == h0 && u == u0 && w == w0 && b == b0, "scroll: zero shift changes nothing");
            scroll(h, u, w, nullptr, W, Hh, 2, 1);
            check(b == b0 && h != h0, "scroll: bPtr == 0 scrolls the field and leaves the bed alone");
        }

        // 7b. Lake at rest across a scroll + bed rewrite. h/u/w scroll, then the
        //     rasterizer rewrites b from the world function at the new origin,
        //     then the solver steps. The bed is world-fixed, so a flat free
        //     surface must generate no current however the window moves.
        {
            auto sloped = [](float wx, float wz) {
                return 0.4f + 0.3f * std::sin(0.3f * wx + 0.2f * wz);
            };
            std::vector<float> h(static_cast<std::size_t>(n), 0.f);
            std::vector<float> u(static_cast<std::size_t>(n), 0.f);
            std::vector<float> w(static_cast<std::size_t>(n), 0.f);
            std::vector<float> b(static_cast<std::size_t>(n), 0.f);
            float ox = 0.f, oz = 0.f;
            auto rewrite = [&]() {
                for (int z = 0; z < kHeight; ++z)
                    for (int x = 0; x < kWidth; ++x)
                        b[static_cast<std::size_t>(z * kWidth + x)] =
                            sloped(ox + static_cast<float>(x) * kDx, oz + static_cast<float>(z) * kDx);
            };
            rewrite();

            float maxVel = 0.f, maxDrift = 0.f;
            auto stepAndMeasure = [&](int steps) {
                for (int s = 0; s < steps; ++s) {
                    stepBed(h, u, w, b, 0.01f);
                    for (int i = 0; i < n; ++i) {
                        if (kH + h[i] - b[i] <= 1e-4f) continue;
                        maxVel = std::max(maxVel, std::max(std::abs(u[i]), std::abs(w[i])));
                        maxDrift = std::max(maxDrift, std::abs(h[i]));
                    }
                }
            };
            stepAndMeasure(5);
            // Includes the 3-cell scroll the contract calls out, on each axis and diagonally.
            const int moves[][2] = { {3, 0}, {0, -3}, {-2, 2}, {3, 3} };
            for (const auto& m : moves) {
                ox -= static_cast<float>(m[0]) * kDx;
                oz -= static_cast<float>(m[1]) * kDx;
                scroll(h, u, w, &b, kWidth, kHeight, m[0], m[1]);
                rewrite();
                stepAndMeasure(20);
            }
            check(maxVel < 1e-5f, "lake at rest across scroll + bed rewrite generates no current");
            check(maxDrift < 1e-5f, "lake at rest across scroll + bed rewrite keeps a flat surface");
        }

        // 7b'. A raised flat lake stays at rest only if the entering edge carries
        //      the same surface — that is what the explicit inflow argument is for.
        {
            constexpr float kEta = 0.05f;
            std::vector<float> h(static_cast<std::size_t>(n), kEta);
            std::vector<float> u(static_cast<std::size_t>(n), 0.f);
            std::vector<float> w(static_cast<std::size_t>(n), 0.f);
            std::vector<float> b(static_cast<std::size_t>(n), 0.f);
            scroll(h, u, w, &b, kWidth, kHeight, 3, -2, kEta);
            float maxVel = 0.f, maxDrift = 0.f;
            for (int s = 0; s < 30; ++s) {
                stepBed(h, u, w, b, 0.01f);
                for (int i = 0; i < n; ++i) {
                    maxVel = std::max(maxVel, std::max(std::abs(u[i]), std::abs(w[i])));
                    maxDrift = std::max(maxDrift, std::abs(h[i] - kEta));
                }
            }
            check(maxVel < 1e-5f && maxDrift < 1e-5f,
                  "scroll: inflowEta lets an entering edge continue a raised lake at rest");
        }

        // 7b''. Sampled U-channel: banks stay dry, thalweg stays wet, still at rest,
        //       as the window slides along and across the channel.
        {
            const float bankBed = kH + 2.f;
            const int halfChannel = 4;
            // Channel centre in world columns, fixed: 16 cells from the initial origin.
            const float centreX = 16.f * kDx;
            auto channel = [&](float wx) {
                const float offsetCells = std::abs(wx - centreX) / kDx;
                if (offsetCells > static_cast<float>(halfChannel) + 0.01f) return bankBed;
                const float r = offsetCells / static_cast<float>(halfChannel);
                return 0.9f * kH * r * r;
            };
            std::vector<float> h(static_cast<std::size_t>(n), 0.f);
            std::vector<float> u(static_cast<std::size_t>(n), 0.f);
            std::vector<float> w(static_cast<std::size_t>(n), 0.f);
            std::vector<float> b(static_cast<std::size_t>(n), 0.f);
            float ox = 0.f;
            auto rewrite = [&]() {
                for (int z = 0; z < kHeight; ++z)
                    for (int x = 0; x < kWidth; ++x)
                        b[static_cast<std::size_t>(z * kWidth + x)] = channel(ox + static_cast<float>(x) * kDx);
            };
            rewrite();
            // Settle: dry cells pin eta to the bed, as they do in the live field.
            for (int s = 0; s < 3; ++s) stepBed(h, u, w, b, 0.01f);

            float maxVel = 0.f, maxDrift = 0.f;
            bool bankDry = true, thalwegWet = true;
            const int moves[][2] = { {0, 3}, {2, 0}, {-3, -1}, {0, 5} };
            for (const auto& m : moves) {
                ox -= static_cast<float>(m[0]) * kDx;
                scroll(h, u, w, &b, kWidth, kHeight, m[0], m[1]);
                rewrite();
                for (int s = 0; s < 20; ++s) {
                    stepBed(h, u, w, b, 0.01f);
                    for (int z = 0; z < kHeight; ++z) {
                        for (int x = 0; x < kWidth; ++x) {
                            const std::size_t i = static_cast<std::size_t>(z * kWidth + x);
                            const float depth = kH + h[i] - b[i];
                            const bool inChannel = b[i] < bankBed;
                            if (inChannel) {
                                thalwegWet = thalwegWet && depth > 1e-3f;
                                maxVel = std::max(maxVel, std::max(std::abs(u[i]), std::abs(w[i])));
                                maxDrift = std::max(maxDrift, std::abs(h[i]));
                            } else {
                                bankDry = bankDry && depth <= 1e-4f;
                            }
                        }
                    }
                }
            }
            check(maxVel < 1e-5f && maxDrift < 1e-5f, "U-channel at rest across scrolls generates no current");
            check(bankDry, "U-channel banks stay dry across scrolls");
            check(thalwegWet, "U-channel thalweg stays wet across scrolls");
        }

        // 7c. A moving window tracks a fixed one. Same splash, same flat bed, same
        //     steps; one grid never moves, the other's window travels several
        //     cells. In world space the bump must stay where it is and evolve the
        //     same, so away from the edges the two agree to round-off.
        {
            std::vector<float> hR(static_cast<std::size_t>(n), 0.f), uR = hR, wR = hR;
            std::vector<float> hS = hR, uS = hR, wS = hR;
            const int cx = 16, cz = 12;  // splash cell in the FIXED grid's frame
            for (int dz = -3; dz <= 3; ++dz) {
                for (int dxc = -3; dxc <= 3; ++dxc) {
                    const float g2 = std::exp(-static_cast<float>(dxc * dxc + dz * dz) / 3.f);
                    hR[static_cast<std::size_t>((cz + dz) * kWidth + cx + dxc)] = 0.3f * g2;
                }
            }
            hS = hR;

            // Window travels +X one cell every 3 steps and -Z one cell every 6:
            // shiftX = -1 / shiftZ = +1 per the (old - new) / dx convention.
            int cellX = 0, cellZ = 0;
            for (int step = 0; step < 18; ++step) {
                if (step % 3 == 0 && step > 0) {
                    cellX += 1;
                    scroll(hS, uS, wS, nullptr, kWidth, kHeight, -1, 0);
                }
                if (step % 6 == 0 && step > 0) {
                    cellZ -= 1;
                    scroll(hS, uS, wS, nullptr, kWidth, kHeight, 0, 1);
                }
                stepFlat(hR, uR, wR, 0.01f);
                stepFlat(hS, uS, wS, 0.01f);
            }
            check(cellX == 5 && cellZ == -2, "fixture: window moved several cells on both axes");

            // World cell (i, j) of the scrolled grid is (i + cellX, j + cellZ) of the fixed one.
            float worst = 0.f, peak = 0.f;
            int peakX = -1, peakZ = -1;
            for (int j = 4; j < kHeight - 4; ++j) {
                for (int i = 4; i < kWidth - 4; ++i) {
                    const int fi = i + cellX;
                    const int fj = j + cellZ;
                    if (fi < 4 || fi >= kWidth - 4 || fj < 4 || fj >= kHeight - 4) continue;
                    const std::size_t s = static_cast<std::size_t>(j * kWidth + i);
                    const std::size_t r = static_cast<std::size_t>(fj * kWidth + fi);
                    worst = std::max({worst, std::abs(hS[s] - hR[r]), std::abs(uS[s] - uR[r]), std::abs(wS[s] - wR[r])});
                    if (hS[s] > peak) { peak = hS[s]; peakX = i + cellX; peakZ = j + cellZ; }
                }
            }
            check(peak > 0.02f, "fixture: the splash is still there after the scrolls");
            check(worst < 1e-6f, "scrolled window tracks the fixed window in world space");
            check(std::abs(peakX - cx) <= 1 && std::abs(peakZ - cz) <= 1,
                  "the splash stays on its world cell while the window moves");
        }
    }

    // ------------------------------------------------------------------
    // 8. Channel routing (routing.cpp, ABI 10) and the routed upstream edge
    //    (stepShallowWaterInflow). A 20-segment chain of ~100 m reaches.
    // ------------------------------------------------------------------
    {
        constexpr int kSeg = 20;
        constexpr float kQ0 = 40.f;          // base discharge (m³/s)
        constexpr float kRelease = 14.f;     // dam release on top (0.35 × base)
        constexpr float kRouteDt = 1.f;
        std::vector<float> L(kSeg), S(kSeg), B(kSeg);
        for (int k = 0; k < kSeg; ++k) {
            L[k] = 95.f + 2.f * static_cast<float>(k % 5);
            S[k] = 0.03f + 0.005f * static_cast<float>(k % 3);
            B[k] = 10.f + static_cast<float>(k % 4);
        }
        std::vector<float> storage(kSeg * ROUTING_SUBREACHES), outflow(kSeg), lag(kSeg);
        auto P = [](std::vector<float>& v) { return reinterpret_cast<uintptr_t>(v.data()); };
        auto totalStorage = [&]() {
            double s = 0.0;
            for (float v : storage) s += v;
            return s;
        };

        // 8a. Steady state carries its discharge through unchanged.
        routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
        for (int t = 0; t < 200; ++t) routeReach(P(L), P(S), P(B), kSeg, kQ0, kRouteDt, P(storage), P(outflow));
        checkClose(outflow[kSeg - 1], kQ0, 1e-4f, "routing: steady discharge stays steady");

        // 8b. Step release at the head: the far segment only answers after the
        //     routed lag, and then it does answer.
        routeReachTravelTime(P(L), P(S), P(B), kSeg, kQ0, P(lag));
        const float lagFar = lag[kSeg - 1];
        check(lagFar > 60.f && lagFar < 1200.f, "routing: 2 km travel time is minutes, not hours or zero");
        for (int k = 1; k < kSeg; ++k) check(lag[k] > lag[k - 1], "routing: lag grows downstream");
        routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
        float riseAtHalfLag = -1.f, riseAtLag = -1.f, riseLate = -1.f;
        const int steps = static_cast<int>(3.f * lagFar / kRouteDt);
        for (int t = 1; t <= steps; ++t) {
            routeReach(P(L), P(S), P(B), kSeg, kQ0 + kRelease, kRouteDt, P(storage), P(outflow));
            const float time = static_cast<float>(t) * kRouteDt;
            const float rise = (outflow[kSeg - 1] - kQ0) / kRelease;
            if (riseAtHalfLag < 0.f && time >= 0.5f * lagFar) riseAtHalfLag = rise;
            if (riseAtLag < 0.f && time >= 1.25f * lagFar) riseAtLag = rise;
            riseLate = rise;
        }
        check(riseAtHalfLag >= -1e-5f && riseAtHalfLag < 0.02f, "routing: nothing arrives before the lag");
        check(riseAtLag > 0.5f, "routing: the release has arrived by 1.25 × lag");
        checkClose(riseLate, 1.f, 1e-3f, "routing: the full release arrives");

        // 8c. Volume: a finite pulse in, everything out, nothing gained.
        routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
        const double s0 = totalStorage();
        double in = 0.0, out = 0.0;
        for (int t = 0; t < 4000; ++t) {
            const float q = (t < 300) ? kQ0 + kRelease : kQ0;
            routeReach(P(L), P(S), P(B), kSeg, q, kRouteDt, P(storage), P(outflow));
            in += static_cast<double>(q) * kRouteDt;
            out += static_cast<double>(outflow[kSeg - 1]) * kRouteDt;
        }
        const double balance = in - out - (totalStorage() - s0);
        check(std::abs(balance) < 1e-4 * in, "routing: volume in = out + stored (1e-4 of throughput)");
        check(out <= in + 1e-4 * in, "routing: never gains volume");

        // 8d. Rating: the reference discharge is exactly still water.
        const RoutedEdge rest = routedEdgeState(kQ0, kQ0, kH, kG);
        check(rest.eta == 0.f && rest.speed == 0.f, "routedEdgeState: Qref is exactly rest");
        const RoutedEdge high = routedEdgeState(kQ0 + kRelease, kQ0, kH, kG);
        checkClose(high.eta, kH * (std::pow((kQ0 + kRelease) / kQ0, 0.6f) - 1.f), 1e-5f, "routedEdgeState: Manning rating");
        check(high.speed > 0.f, "routedEdgeState: a raised stage moves downstream");

        auto P2 = [](std::vector<float>& v) { return reinterpret_cast<uintptr_t>(v.data()); };
        auto stepEdge = [&](std::vector<float>& h, std::vector<float>& u, std::vector<float>& w,
                            std::vector<float>* b, float dt, float edgeEta) {
            stepShallowWaterInflow(P2(h), P2(u), P2(w), b ? P2(*b) : 0,
                                   kWidth, kHeight, dt, kG, kDx, kH, edgeEta);
        };

        // 8e. Lake at rest with the edge on: the reference discharge over a
        //     bumpy, partly dry bed invents no slope — η steps bit-for-bit like
        //     the transmissive solver, still inside the 3b tolerance.
        {
            std::vector<float> h(n, 0.f), u(n, 0.f), w(n, 0.f), b(n, 0.f);
            for (int z = 0; z < kHeight; ++z) {
                for (int x = 0; x < kWidth; ++x) {
                    const float r = std::hypot(static_cast<float>(x) - 16.f, static_cast<float>(z) - 22.f);
                    b[z * kWidth + x] = std::max(0.f, 1.4f - 0.15f * r);  // bump through the top edge
                    if (x < 3) b[z * kWidth + x] = 1.6f;                  // dry bank column
                }
            }
            for (int i = 0; i < n; ++i) if (b[i] > kH) h[i] = b[i] - kH;  // dry: surface pinned to bed
            std::vector<float> hT = h, uT = u, wT = w;
            for (int t = 0; t < 400; ++t) {
                stepEdge(h, u, w, &b, 1.f / 60.f, rest.eta);
                stepBed(hT, uT, wT, b, 1.f / 60.f);
            }
            // η is the slope the player sees: identical to the transmissive
            // step. Velocities may differ by round-off once the solver's own
            // float residue (~1e-7 m/s) reaches the edge characteristics.
            bool sameEta = true;
            float maxVel = 0.f, dVel = 0.f;
            for (int i = 0; i < n; ++i) {
                sameEta = sameEta && h[i] == hT[i];
                maxVel = std::max({maxVel, std::abs(u[i]), std::abs(w[i])});
                dVel = std::max({dVel, std::abs(u[i] - uT[i]), std::abs(w[i] - wT[i])});
            }
            check(sameEta, "edge inflow at Qref: eta bit-identical to the transmissive step");
            check(dVel < 1e-6f, "edge inflow at Qref: velocity matches transmissive to round-off");
            check(maxVel < 2e-3f, "edge inflow at Qref: lake at rest (3b tolerance)");
        }

        // 8f. A raised edge stage enters from the upstream (high-row) edge and
        //     flows downstream (−Z); the downstream edge does not reflect it.
        {
            std::vector<float> h(n, 0.f), u(n, 0.f), w(n, 0.f);
            const float eta = high.eta;
            for (int t = 0; t < 30; ++t) stepEdge(h, u, w, nullptr, 1.f / 60.f, eta);
            const int mid = kWidth / 2;
            check(h[(kHeight - 1) * kWidth + mid] > 0.5f * eta, "edge stage: top row rises toward the routed stage");
            check(w[(kHeight - 1) * kWidth + mid] < 0.f, "edge stage: the inflow moves downstream (−Z)");
            check(std::abs(h[0 * kWidth + mid]) < 1e-4f, "edge stage: the far edge has not heard of it yet");
            check(std::abs(u[(kHeight - 1) * kWidth + mid]) < 1e-5f, "edge stage: no lateral current from a uniform edge");
            for (int t = 0; t < 1200; ++t) stepEdge(h, u, w, nullptr, 1.f / 60.f, eta);
            float lo = 1e9f, hi = -1e9f;
            for (int i = 0; i < n; ++i) { lo = std::min(lo, h[i]); hi = std::max(hi, h[i]); }
            check(lo > 0.5f * eta && hi < 1.5f * eta, "edge stage: the window fills to the routed stage, no runaway");
        }

        // 8g. The whole chain: a release at the head reaches a downstream
        //     segment's edge stage only after that segment's lag.
        {
            const int k = kSeg - 1;
            routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
            float early = -1.f, late = -1.f;
            for (int t = 1; t <= steps; ++t) {
                routeReach(P(L), P(S), P(B), kSeg, kQ0 + kRelease, kRouteDt, P(storage), P(outflow));
                const float time = static_cast<float>(t) * kRouteDt;
                const float eta = routedEdgeState(outflow[k], kQ0, kH, kG).eta;
                if (early < 0.f && time >= 0.5f * lag[k]) early = eta;
                if (late < 0.f && time >= 1.5f * lag[k]) late = eta;
            }
            check(early < 0.01f, "routed edge: stage flat before the lag");
            check(late > 0.5f * high.eta, "routed edge: stage raised after the lag");
            // Goldens, mirrored in smoke_test.mjs against the WASM build (same
            // chain, same numbers, same 1e-4 relative tolerance). Bitwise
            // host == wasm is native_digest.h's job; these are physics.
            checkClose(lagFar, 264.890015f, 1e-4f, "routing golden: far-segment lag (s)");
            checkClose(riseAtLag, 0.999229f, 1e-4f, "routing golden: release fraction at 1.25 x lag");
            checkClose(high.eta, 0.197293f, 1e-4f, "routing golden: edge stage for +35% discharge");
        }

        // 8h. Lateral inflow (ABI 14): rain over reach 2 feeds reach 2 at once,
        //     the reaches below with the routed lag, never the reaches above;
        //     zero lateral is routeReach bit for bit; volume still balances.
        {
            constexpr int kStorm = 2;
            std::vector<float> lateral(kSeg, 0.f);
            std::vector<float> storageA(kSeg * ROUTING_SUBREACHES), outflowA(kSeg);
            routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
            routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storageA), P(outflowA));
            bool same = true;
            for (int t = 0; t < 50; ++t) {
                routeReach(P(L), P(S), P(B), kSeg, kQ0 + kRelease, kRouteDt, P(storage), P(outflow));
                routeReachLateral(P(L), P(S), P(B), kSeg, kQ0 + kRelease, P(lateral), kRouteDt, P(storageA), P(outflowA));
                for (int k = 0; k < kSeg; ++k) same = same && outflow[k] == outflowA[k];
            }
            check(same, "lateral: all-zero lateral routes bit for bit like routeReach");

            routeReachSteady(P(L), P(S), P(B), kSeg, kQ0, P(storage), P(outflow));
            lateral[kStorm] = kRelease;
            const double s0 = totalStorage();
            double in = 0.0, out = 0.0;
            float firstAt2 = -1.f, firstAt0 = -1.f, firstAtLast = -1.f;
            for (int t = 1; t <= 4000; ++t) {
                const bool raining = t <= 300;
                lateral[kStorm] = raining ? kRelease : 0.f;
                routeReachLateral(P(L), P(S), P(B), kSeg, kQ0, P(lateral), kRouteDt, P(storage), P(outflow));
                in += static_cast<double>(kQ0 + (raining ? kRelease : 0.f)) * kRouteDt;
                out += static_cast<double>(outflow[kSeg - 1]) * kRouteDt;
                const float time = static_cast<float>(t) * kRouteDt;
                // Stage into a reach = what joins it: the outflow above (head
                // for reach 0) plus its own lateral.
                const float into2 = outflow[kStorm - 1] + lateral[kStorm];
                if (firstAt2 < 0.f && into2 > kQ0 + 0.5f * kRelease) firstAt2 = time;
                if (firstAt0 < 0.f && outflow[0] > kQ0 + 0.01f * kRelease) firstAt0 = time;
                if (firstAtLast < 0.f && outflow[kSeg - 1] > kQ0 + 0.5f * kRelease) firstAtLast = time;
            }
            check(firstAt2 > 0.f && firstAt2 <= kRouteDt, "lateral: rain over reach 2 raises reach 2 at once");
            check(firstAt0 < 0.f, "lateral: the reaches above the storm never see it");
            check(firstAtLast > firstAt2 + 0.5f * (lag[kSeg - 1] - lag[kStorm]), "lateral: the reaches below hear it after the lag");
            const double balance = in - out - (totalStorage() - s0);
            check(std::abs(balance) < 1e-4 * in, "lateral: volume in (head + lateral) = out + stored");
        }
    }

    // 8i. Surge front (applySWEEvent kind 4, ABI 14): a band across the whole
    //     window takes the stage step and the bore's downstream speed; it only
    //     raises, and cells off the band are untouched.
    {
        const int w = 8, h = 16, N = w * h;
        std::vector<float> hS(N, 0.f), uS(N, 0.f), wS(N, 0.f), bS(N, 0.f);
        auto surge = [&](float cz) {
            applySWEEvent(
                reinterpret_cast<uintptr_t>(hS.data()),
                reinterpret_cast<uintptr_t>(uS.data()),
                reinterpret_cast<uintptr_t>(wS.data()),
                reinterpret_cast<uintptr_t>(bS.data()),
                w, h, 1.f, 0.f, 0.f, 1.2f,
                4, 3.5f, cz, 2.f, 0.3f, 1.f / 60.f);
        };
        for (int t = 0; t < 60; ++t) surge(10.f);
        float edgeLo = 1e9f, centre = 0.f, offBand = 0.f, minW = 0.f;
        for (int i = 0; i < w; ++i) {
            edgeLo = std::min(edgeLo, hS[10 * w + i]);
            centre = std::max(centre, hS[10 * w + i]);
            offBand = std::max({offBand, std::abs(hS[2 * w + i]), std::abs(wS[2 * w + i])});
            minW = std::min(minW, wS[10 * w + i]);
        }
        check(edgeLo > 0.25f, "surge: the band spans the window (cx is not a centre)");
        check(centre <= 0.3f + 1e-6f, "surge: the stage settles on the step, not past it");
        check(minW < -0.1f, "surge: the water under the front moves downstream");
        check(offBand == 0.f, "surge: cells off the band are untouched");
        hS[10 * w + 3] = 0.6f;
        surge(10.f);
        check(hS[10 * w + 3] == 0.6f, "surge: water above the step is left alone");
    }


    // 9. Terrain tile (terrain.cpp, ABI 13, #487). Goldens are mirrored in
    //    src/terrain/__tests__/terrainFixtures.ts and emscripten/smoke_test.mjs.
    {
        using namespace terrain_goldens;
        const bool print = std::getenv("WATERSHED_PRINT_TERRAIN_GOLDENS") != nullptr;
        for (int f = 0; f < kFixtureCount; ++f) {
            const Fixture& fx = kFixtures[f];
            const Golden& g = kGoldens[f];
            TileParams params;
            params.pathLength = fx.pathLength;
            params.canyonWidth = fx.canyonWidth;
            params.waterWidth = fx.waterWidth;
            params.segmentsX = fx.segmentsX;
            params.segmentsZ = fx.segmentsZ;
            params.profile = fx.profile;
            params.rockNoise = fx.rockNoise;
            params.hasTube = fx.hasTube;
            params.tubeCurl = fx.tubeCurl;
            params.tubeCeiling = fx.tubeCeiling;
            params.channel = std::span<const float>(fx.channel, static_cast<size_t>(fx.channelCount) * TERRAIN_CHANNEL_STRIDE);
            const int n = terrainVertexCount(fx.segmentsX, fx.segmentsZ);
            std::vector<float> planes(static_cast<size_t>(n) * TERRAIN_TILE_PLANES, -999.f);
            TerrainTile tile{planes};
            check(buildTerrainTile(params, tile) == n, "terrain: buildTerrainTile returns the vertex count");
            const auto at = [&](int k, int i) { return planes[static_cast<size_t>(k) * n + i]; };
            double sums[TERRAIN_TILE_PLANES] = {};
            double absX = 0.0;
            double absSlopeX = 0.0;
            bool finite = true;
            for (int k = 0; k < TERRAIN_TILE_PLANES; ++k) {
                for (int i = 0; i < n; ++i) {
                    finite = finite && std::isfinite(at(k, i));
                    sums[k] += at(k, i);
                }
            }
            for (int i = 0; i < n; ++i) {
                absX += std::abs(at(TERRAIN_PLANE_X, i));
                absSlopeX += std::abs(at(TERRAIN_PLANE_SLOPE_X, i));
            }
            check(finite, "terrain: every plane is finite");
            if (print) {
                std::printf("    {%.9g, %.9g, %.9g, %.9g, %.9g, %.9g, {%d, %d, %d}, {%.9g, %.9g, %.9g}},  // %s\n",
                            absX, sums[TERRAIN_PLANE_H], sums[TERRAIN_PLANE_BANK],
                            sums[TERRAIN_PLANE_SLOPE_X], sums[TERRAIN_PLANE_SLOPE_Z], absSlopeX,
                            g.probe[0], g.probe[1], g.probe[2],
                            at(TERRAIN_PLANE_H, g.probe[0]), at(TERRAIN_PLANE_H, g.probe[1]),
                            at(TERRAIN_PLANE_H, g.probe[2]), fx.name);
                continue;
            }
            const auto close = [&](double actual, double expected, const char* what) {
                const double tol = std::max(std::abs(expected) * 1e-5, 1e-4);
                if (!(std::abs(actual - expected) <= tol)) {
                    std::fprintf(stderr, "FAIL  terrain golden %s / %s: expected %.9g, got %.9g\n",
                                 fx.name, what, expected, actual);
                    ++g_failures;
                }
            };
            close(absX, g.sumAbsX, "sum |X|");
            close(sums[TERRAIN_PLANE_H], g.sumH, "sum H");
            close(sums[TERRAIN_PLANE_BANK], g.sumBank, "sum bank");
            close(sums[TERRAIN_PLANE_SLOPE_X], g.sumSlopeX, "sum slopeX");
            close(sums[TERRAIN_PLANE_SLOPE_Z], g.sumSlopeZ, "sum slopeZ");
            close(absSlopeX, g.sumAbsSlopeX, "sum |slopeX|");
            for (int p = 0; p < 3; ++p) close(at(TERRAIN_PLANE_H, g.probe[p]), g.probeH[p], "probe H");

            // Structural: uv spans the tile, the centre column is wet, the outer columns are bank.
            const int cols = fx.segmentsX + 1;
            const int midRow = (fx.segmentsZ / 2) * cols;
            check(at(TERRAIN_PLANE_UV_U, 0) == 0.f && at(TERRAIN_PLANE_UV_U, cols - 1) == 1.f, "terrain: uvU spans 0..1");
            checkClose(at(TERRAIN_PLANE_UV_V, n - 1), static_cast<float>(fx.pathLength), 1e-6f, "terrain: uvV ends at the path length");
            check(at(TERRAIN_PLANE_BANK, midRow + cols / 2) == 0.f, "terrain: the thalweg is in the channel");
            check(at(TERRAIN_PLANE_BANK, midRow) == 1.f && at(TERRAIN_PLANE_BANK, midRow + cols - 1) == 1.f,
                  "terrain: the canyon edges are bank");
            if (fx.hasTube) {
                // The fold pulls the outer column inboard of a column further in: the overhang.
                const float outer = std::abs(at(TERRAIN_PLANE_X, midRow));
                const float inner = std::abs(at(TERRAIN_PLANE_X, midRow + 2));
                check(outer < inner, "terrain: the ice tube overhangs (outer wall inboard of its springing)");
                checkClose(at(TERRAIN_PLANE_H, midRow), static_cast<float>(fx.tubeCeiling), 1e-5f,
                           "terrain: the tube crown lands on the authored ceiling");
            } else {
                check(at(TERRAIN_PLANE_X, 0) == static_cast<float>(-fx.canyonWidth / 2), "terrain: open canyon x is the grid x");
            }
        }

        // Guards: nothing is written for a degenerate path or a short buffer.
        std::vector<float> small(TERRAIN_TILE_PLANES * 4, 7.f);
        TerrainTile smallTile{small};
        TileParams bad;
        bad.pathLength = 0.0;
        bad.canyonWidth = 30.0;
        bad.segmentsX = 1;
        bad.segmentsZ = 1;
        check(buildTerrainTile(bad, smallTile) == 0, "terrain: zero path length is rejected");
        bad.pathLength = std::numeric_limits<double>::quiet_NaN();
        check(buildTerrainTile(bad, smallTile) == 0, "terrain: NaN path length is rejected");
        bad.pathLength = 10.0;
        bad.segmentsX = 2;
        check(buildTerrainTile(bad, smallTile) == 0, "terrain: a short output buffer is rejected");
        bad.segmentsX = TERRAIN_MAX_SEGMENTS + 1;
        check(terrainVertexCount(bad.segmentsX, 1) == 0, "terrain: oversized grids are rejected");
        check(std::all_of(small.begin(), small.end(), [](float v) { return v == 7.f; }),
              "terrain: rejected calls write nothing");

        for (const WallFixture& wf : kWallFixtures) {
            const int n = terrainVertexCount(wf.params.segmentsX, wf.params.segmentsZ);
            std::vector<float> shell(static_cast<size_t>(n));
            check(buildWallShell(wf.params, shell) == n, "terrain: buildWallShell returns the vertex count");
            double sum = 0.0;
            for (float v : shell) sum += v;
            if (print) {
                std::printf("    wall %s: sum %.9g probe[%d] %.9g\n", wf.name, sum, wf.probe, shell[wf.probe]);
                continue;
            }
            const double tol = std::max(std::abs(wf.sum) * 1e-5, 1e-4);
            if (!(std::abs(sum - wf.sum) <= tol) || !(std::abs(shell[wf.probe] - wf.probeY) <= 1e-4)) {
                std::fprintf(stderr, "FAIL  wall golden %s: sum %.9g (want %.9g), probe %.9g (want %.9g)\n",
                             wf.name, sum, wf.sum, shell[wf.probe], wf.probeY);
                ++g_failures;
            }
        }
    }

    // ------------------------------------------------------------------
    // Non-finite scalars: a NaN slips past `x <= 0` and `std::max(x, lo)`
    // (which returns its first operand), so before these guards one NaN dt
    // turned the whole SWE field into NaN and one NaN head discharge poisoned
    // the routed chain, both for the rest of the session.
    // ------------------------------------------------------------------
    {
        constexpr float kNaN = std::numeric_limits<float>::quiet_NaN();
        constexpr float kInf = std::numeric_limits<float>::infinity();
        const auto P = [](auto& v) { return reinterpret_cast<uintptr_t>(v.data()); };
        const auto finite = [](const std::vector<float>& v) {
            return std::all_of(v.begin(), v.end(), [](float x) { return std::isfinite(x); });
        };

        constexpr int kW = 12;
        constexpr int kZ = 10;
        const std::size_t cells = static_cast<std::size_t>(kW) * kZ;
        std::vector<float> h(cells), u(cells, 0.5f), w(cells, -0.25f), b(cells, 0.1f);
        for (std::size_t i = 0; i < cells; ++i) h[i] = 0.05f * std::sin(0.7f * static_cast<float>(i));
        const std::vector<float> h0 = h;
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, kNaN, kG, kDx, kH);
        stepShallowWaterInflow(P(h), P(u), P(w), P(b), kW, kZ, kNaN, kG, kDx, kH, 0.1f);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kNaN, kDx, kH);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kG, kNaN, kH);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kG, kDx, kNaN);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kInf, kDx, kH);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kG, kInf, kH);
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 0.01f, kG, kDx, kInf);
        check(h == h0, "swe: a NaN / inf dt, g, dx or H steps nothing");
        stepShallowWater(P(h), P(u), P(w), P(b), kW, kZ, kInf, kG, kDx, kH);
        check(finite(h) && finite(u) && finite(w) && h != h0, "swe: dt = +inf is clamped to the CFL step");
        applySWEEvent(P(h), P(u), P(w), P(b), kW, kZ, kDx, 0.f, 0.f, kH, 0, 4.f, 4.f, 2.f, kInf, 0.016f);
        applySWEEvent(P(h), P(u), P(w), P(b), kW, kZ, kDx, 0.f, 0.f, kH, 0, 4.f, 4.f, 2.f, 1.f, kInf);
        applySWEEvent(P(h), P(u), P(w), P(b), kW, kZ, kDx, 0.f, 0.f, kInf, 0, 4.f, 4.f, 2.f, 1.f, 0.016f);
        scrollShallowWater(P(h), P(u), P(w), P(b), kW, kZ, 2, -3, kNaN, kInf, -kInf);
        check(finite(h) && finite(u) && finite(w) && finite(b), "swe: NaN / inf event and inflow scalars stay out of the field");

        constexpr int kSegs = 3;
        std::vector<float> L(kSegs, 100.f), S(kSegs, 0.01f), B(kSegs, 12.f), lateral(kSegs, 0.f);
        std::vector<float> storage(static_cast<std::size_t>(kSegs) * ROUTING_SUBREACHES), outflow(kSegs), lag(kSegs);
        routeReachSteady(P(L), P(S), P(B), kSegs, 5.f, P(storage), P(outflow));
        routeReach(P(L), P(S), P(B), kSegs, kNaN, 1.f, P(storage), P(outflow));
        routeReach(P(L), P(S), P(B), kSegs, kInf, 1.f, P(storage), P(outflow));
        routeReach(P(L), P(S), P(B), kSegs, 5.f, kInf, P(storage), P(outflow));
        routeReach(P(L), P(S), P(B), kSegs, 5.f, 1e-40f, P(storage), P(outflow));
        L[1] = kNaN;
        B[2] = kNaN;
        routeReachLateral(P(L), P(S), P(B), kSegs, 5.f, P(lateral), 1.f, P(storage), P(outflow));
        routeReachTravelTime(P(L), P(S), P(B), kSegs, kNaN, P(lag));
        routeReachSteady(P(L), P(S), P(B), kSegs, kNaN, P(storage), P(outflow));
        routeReach(P(L), P(S), P(B), kSegs, 5.f, 1.f, P(storage), P(outflow));
        check(finite(storage) && finite(outflow) && finite(lag), "routing: NaN / inf head discharge, dt, length or width stays finite");
        const RoutedEdge inf = routedEdgeState(6.f, 5.f, kInf, kG);
        check(inf.eta == 0.f && inf.speed == 0.f, "routedEdgeState: an infinite H is rest");

        const uintptr_t soa = allocateParticleSoA(8);
        const std::span<const float> planes(reinterpret_cast<const float*>(soa), 8 * PARTICLE_SOA_PLANES);
        uint32_t seed = initWaterfallParticles(soa, 8, 8, kNaN, 10.f, 1.f, 0.5f, 7u);
        seed = initWaterfallParticles(soa, 8, 8, 4.f, 10.f, 1.f, 0.5f, seed);
        seed = stepWaterfallParticles(soa, 8, 8, kNaN, 4.f, 10.f, 1.f, seed);
        seed = stepWaterfallParticles(soa, 8, 8, 0.016f, kInf, 10.f, 1.f, seed);
        stepSplashParticles(soa, 8, 8, kNaN, -9.8f, 0.98f);
        stepSplashParticles(soa, 8, 8, 0.016f, kNaN, 0.98f);
        check(std::all_of(planes.begin(), planes.end(), [](float x) { return std::isfinite(x); }),
              "particles: NaN / inf scalars never reach the SoA");
        freeParticleSoA(soa);
    }

    // ------------------------------------------------------------------
    // Untrusted-input sentinels (#502): every entry point that takes a heap
    // pointer or a JS extent returns early, writing nothing, on a null pointer
    // or an out-of-range count / extent. Each rejected call below would write
    // through null or past `guard` if it got that far (ASan catches it under
    // test:native:sanitize); the 7.f fill proves nothing was written.
    // ------------------------------------------------------------------
    {
        const auto at = [](auto& v) { return reinterpret_cast<uintptr_t>(v.data()); };
        const auto untouched = [](const std::vector<float>& v) {
            return std::all_of(v.begin(), v.end(), [](float x) { return x == 7.f; });
        };
        std::vector<float> src(16, 1.f);
        std::vector<float> guard(16, 7.f);
        std::vector<uint32_t> bins(256, 7u);
        const auto binsUntouched = [&bins] {
            return std::all_of(bins.begin(), bins.end(), [](uint32_t x) { return x == 7u; });
        };

        reduceF32Grid(at(src), 4, 0);
        reduceF32Grid(0, 4, at(guard));
        reduceF32Grid(at(src), -1, at(guard));
        reduceF32Grid(at(src), WS_MAX_ELEMENTS + 1, at(guard));
        check(untouched(guard), "chores: reduceF32Grid rejects null / negative / oversized");
        reduceF32Grid(0, 0, at(guard));
        check(guard[0] == 0.f && guard[1] == 0.f && guard[2] == 0.f && guard[3] == 7.f,
              "chores: reduceF32Grid of an empty grid writes zeros");
        std::fill(guard.begin(), guard.end(), 7.f);

        histogramF32(at(src), 4, 0.f, 1.f, 0);
        histogramF32(0, 4, 0.f, 1.f, at(bins));
        histogramF32(at(src), -3, 0.f, 1.f, at(bins));
        lumaHistogramU8(0, 4, at(bins));
        lumaHistogramU8(at(src), -1, at(bins));
        lumaHistogramU8(at(src), WS_MAX_ELEMENTS + 1, at(bins));
        check(binsUntouched(), "chores: histograms reject null / negative / oversized");

        downsampleF32(0, 4, 4, at(guard), 2, 2);
        downsampleF32(at(src), 4, 4, 0, 2, 2);
        downsampleF32(at(src), -4, 4, at(guard), 2, 2);
        downsampleF32(at(src), 4, 0, at(guard), 2, 2);
        downsampleF32(at(src), SWE_MAX_GRID_EXTENT + 1, 1, at(guard), 2, 2);
        downsampleF32(at(src), 4, 4, at(guard), SWE_MAX_GRID_EXTENT + 1, 1);
        check(untouched(guard), "chores: downsampleF32 rejects null / non-positive / oversized");
        downsampleF32(at(src), 4, 4, at(guard), 0, -2);
        check(guard[0] == 1.f && guard[1] == 7.f, "chores: downsampleF32 clamps a non-positive destination to 1x1");
        std::fill(guard.begin(), guard.end(), 7.f);

        blurSeparableF32(0, at(guard), 4, 4);
        blurSeparableF32(at(src), 0, 4, 4);
        blurSeparableF32(at(src), at(guard), -4, 4);
        blurSeparableF32(at(src), at(guard), 4, 0);
        blurSeparableF32(at(src), at(guard), SWE_MAX_GRID_EXTENT + 1, 1);
        check(untouched(guard), "chores: blurSeparableF32 rejects null / non-positive / oversized");

        computeWaterForcesBatch(at(src), at(guard), WATER_FORCE_MAX_SAMPLES + 1, 4.5f, 0.5f, 150.f, 1.2f,
                                0.47f, 1.05f, 0.7f, 0.f, 0.f, 2.4f);
        computeWaterForcesBatch(at(src), at(guard), -1, 4.5f, 0.5f, 150.f, 1.2f, 0.47f, 1.05f, 0.7f, 0.f, 0.f, 2.4f);
        check(untouched(guard), "forces: computeWaterForcesBatch rejects negative / oversized counts");

        std::vector<float> storage(16, 7.f);
        routeReach(at(src), at(src), at(src), ROUTING_MAX_SEGMENTS + 1, 1.f, 1.f, at(storage), at(guard));
        routeReach(at(src), at(src), at(src), -2, 1.f, 1.f, at(storage), at(guard));
        routeReachSteady(at(src), at(src), at(src), ROUTING_MAX_SEGMENTS + 1, 1.f, at(storage), at(guard));
        routeReachTravelTime(at(src), at(src), at(src), ROUTING_MAX_SEGMENTS + 1, 1.f, at(guard));
        check(untouched(guard) && untouched(storage), "routing: oversized / negative chains are rejected");

        check(allocateParticleSoA(PARTICLE_MAX_CAPACITY + 1) == 0, "particles: oversized capacity is rejected");
        check(allocateParticleSoA(-1) == 0, "particles: negative capacity is rejected");
        check(stepWaterfallParticles(at(guard), PARTICLE_MAX_CAPACITY + 1, 4, 0.1f, 1.f, 1.f, 1.f, 42u) == 42u
                  && untouched(guard),
              "particles: oversized capacity steps nothing");
        check(allocateGrid(0) == 0 && allocateGrid(-5) == 0, "swe: allocateGrid(<= 0) returns 0");
        // wasm32 size_t: emmalloc's calloc does not check num * size, so
        // the cap and the overflow check must hold in a 32-bit size_t too.
        check(allocBytes<uint32_t>(1 << 30, 4u) == 0, "allocBytes: 2^30 floats are rejected in a 32-bit size_t");
        check(allocBytes<uint32_t>(WS_MAX_ELEMENTS + 1, 4u) == 0, "allocBytes: past WS_MAX_ELEMENTS is rejected");
        check(allocBytes<uint32_t>(WS_MAX_ELEMENTS, 1u << 9) == 0, "allocBytes: a product past 2^32 is rejected, not wrapped");
        check(allocBytes<uint32_t>(128 * 80, 4u) == 128u * 80u * 4u, "allocBytes: an SWE grid is its byte count");
        check(allocateGrid(1 << 30) == 0 && allocateGrid(WS_MAX_ELEMENTS + 1) == 0,
              "swe: allocateGrid rejects counts past WS_MAX_ELEMENTS");
    }

    // ------------------------------------------------------------------
    // Bit-exact digests (native_digest.h): the same numbers gate the shipped
    // wasm in nativeDigest.integration.test.ts, so host == wasm bit for bit.
    // ------------------------------------------------------------------
    {
        const uint32_t swe = native_digest::sweDigest();
        const uint32_t routing = native_digest::routingDigest();
        const uint32_t terrain = native_digest::terrainDigest();
        if (std::getenv("WATERSHED_PRINT_DIGESTS") != nullptr) {
            std::printf("inline constexpr uint32_t kSweDigest = 0x%08xu;\n", swe);
            std::printf("inline constexpr uint32_t kRoutingDigest = 0x%08xu;\n", routing);
            std::printf("inline constexpr uint32_t kTerrainDigest = 0x%08xu;\n", terrain);
        }
        const auto digest = [](uint32_t got, uint32_t want, const char* what) {
            if (got != want) {
                std::fprintf(stderr, "FAIL  %s digest: 0x%08x, native_digest.h says 0x%08x\n", what, got, want);
                ++g_failures;
            }
        };
        // Routing (powf / expf) and terrain (sin / pow) go through the host
        // libm: the digests are glibc's, which agrees with the wasm's musl on
        // these scenarios. Elsewhere (macOS libm) only SWE is libm-free.
        digest(swe, native_digest::kSweDigest, "swe");
#if defined(__GLIBC__)
        digest(routing, native_digest::kRoutingDigest, "routing");
        digest(terrain, native_digest::kTerrainDigest, "terrain");
#else
        std::printf("note: routing / terrain digests are checked on glibc hosts only\n");
#endif
    }

    if (g_failures != 0) {
        std::fprintf(stderr, "watershed_host_smoke: %d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("watershed_host_smoke ok\n");
    return 0;
}
