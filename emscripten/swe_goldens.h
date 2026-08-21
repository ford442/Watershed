/**
 * swe_goldens.h — shared SWE fixture tables for the host smoke runner.
 *
 * Header-only so host_smoke.cpp (and any future host test TU) builds the same
 * grids with the same tolerances. Embind-free; never included by bindings.cpp.
 *
 * The three fixtures are the Phase 1 acceptance checks from #374:
 *   - lakeAtRest    — still water over a bed bump must not generate current
 *   - dryBasin      — cells above the waterline must stay dry
 *   - damBreak      — 1D Riemann slice: positivity, mass, bounded front speed
 */

#ifndef WATERSHED_SWE_GOLDENS_H
#define WATERSHED_SWE_GOLDENS_H

#include "swe.h"

#include <cmath>
#include <cstddef>
#include <vector>

namespace swe_goldens {

/** Grid + step parameters shared by every fixture (medium quality budget). */
struct GridSpec {
    int width  = 32;
    int height = 24;
    float dx   = 0.75f;
    float g    = 9.80665f;
    float refDepth = 1.f;
    int cells() const { return width * height; }
};

/**
 * Maximum spurious current tolerated by the well-balanced check, in m/s.
 * float32 pressure differences over a 1 m bump land around 1e-4; anything
 * larger means hydrostatic reconstruction regressed.
 */
inline constexpr float kLakeAtRestVelocityEps = 2e-3f;

/** Tolerance on surface elevation drift for the lake-at-rest fixture (m). */
inline constexpr float kLakeAtRestSurfaceEps = 2e-3f;

/** Relative tolerance on total-mass conservation for the dam-break fixture. */
inline constexpr float kMassRelEps = 2e-2f;

struct Fields {
    std::vector<float> h;
    std::vector<float> u;
    std::vector<float> w;
    std::vector<float> b;

    explicit Fields(int n)
        : h(static_cast<std::size_t>(n), 0.f),
          u(static_cast<std::size_t>(n), 0.f),
          w(static_cast<std::size_t>(n), 0.f),
          b(static_cast<std::size_t>(n), 0.f) {}
};

/** Bed elevation of the lake-at-rest / dry-basin bump at cell (x, z). */
inline float bumpBed(const GridSpec& spec, int x, int z, float peak) {
    const float cx = static_cast<float>(spec.width) * 0.5f;
    const float cz = static_cast<float>(spec.height) * 0.5f;
    const float dxc = (static_cast<float>(x) - cx) / 6.f;
    const float dzc = (static_cast<float>(z) - cz) / 4.f;
    const float r2 = dxc * dxc + dzc * dzc;
    return peak * std::exp(-r2);
}

/**
 * Still water at surface elevation `surface` over a Gaussian bed bump whose
 * peak stays submerged. Nothing should move.
 */
inline Fields lakeAtRest(const GridSpec& spec, float surface = 1.f, float peak = 0.6f) {
    Fields f(spec.cells());
    for (int z = 0; z < spec.height; ++z) {
        for (int x = 0; x < spec.width; ++x) {
            const int i = z * spec.width + x;
            f.b[i] = bumpBed(spec, x, z, peak);
            f.h[i] = surface - f.b[i];
            if (f.h[i] < 0.f) f.h[i] = 0.f;
        }
    }
    return f;
}

/**
 * Same bed, but the bump breaks the surface: its crest cells start dry and
 * must stay dry (no depth leaking uphill from the surrounding pool).
 */
inline Fields dryBasin(const GridSpec& spec, float surface = 0.4f, float peak = 1.2f) {
    return lakeAtRest(spec, surface, peak);
}

/** True when cell (x, z) of the dry-basin fixture starts dry. */
inline bool dryBasinCellIsDry(const GridSpec& spec, int x, int z,
                              float surface = 0.4f, float peak = 1.2f) {
    return bumpBed(spec, x, z, peak) >= surface;
}

/**
 * Classic dam break on a flat bed: deep water in the left half, shallow in the
 * right. The wet-bed analytic front speed is bounded by u + sqrt(g * hLeft).
 */
inline Fields damBreak(const GridSpec& spec, float hLeft = 1.5f, float hRight = 0.3f) {
    Fields f(spec.cells());
    for (int z = 0; z < spec.height; ++z) {
        for (int x = 0; x < spec.width; ++x) {
            f.h[z * spec.width + x] = (x < spec.width / 2) ? hLeft : hRight;
        }
    }
    return f;
}

inline float totalMass(const std::vector<float>& h) {
    float sum = 0.f;
    for (float v : h) sum += v;
    return sum;
}

/** Step a fixture in place through the public bed entry point. */
inline void step(const GridSpec& spec, Fields& f, float dt) {
    stepShallowWaterBed(
        reinterpret_cast<uintptr_t>(f.h.data()),
        reinterpret_cast<uintptr_t>(f.u.data()),
        reinterpret_cast<uintptr_t>(f.w.data()),
        reinterpret_cast<uintptr_t>(f.b.data()),
        spec.width, spec.height, dt, spec.g, spec.dx, spec.refDepth);
}

}  // namespace swe_goldens

#endif  // WATERSHED_SWE_GOLDENS_H
